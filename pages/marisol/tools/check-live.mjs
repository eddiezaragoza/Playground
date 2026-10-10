#!/usr/bin/env node
// Checks every channel in data/channels.json for a live or upcoming YouTube
// stream and updates data/status.json (current state + rolling history).
//
// No API key needed: reads each channel's public /live page, which YouTube
// redirects to the current (or next scheduled) broadcast.
//
// Usage: node tools/check-live.mjs [--dir <site root>] [--status <status.json path>]

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : join(dirname(fileURLToPath(import.meta.url)), '..');

const CHANNELS = join(root, 'data/channels.json');
const STATUS = process.argv.includes('--status')
  ? process.argv[process.argv.indexOf('--status') + 1]
  : join(root, 'data/status.json');
const HISTORY_PER_CHANNEL = 40;
const CONCURRENCY = 4;
const UA = 'Mozilla/5.0 (compatible; CatholicMainstreamLive/1.0)';

// Extracts the JSON object assigned to `name` in the page's inline scripts.
function extractJson(html, name) {
  const start = html.indexOf(`${name} = {`);
  if (start < 0) return null;
  let i = html.indexOf('{', start);
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(i, j + 1)); } catch { return null; }
    }
  }
  return null;
}

// Page mode (no API key). YouTube sometimes serves datacenter IPs a
// "confirm you're not a bot" player, so fall back to ytInitialData, which
// still carries the current video and its "watching now" live flag.
export async function checkChannel(channelId) {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' },
    redirect: 'follow',
  });
  if (!res.ok) return { state: 'error', error: `HTTP ${res.status}` };
  const html = await res.text();
  const player = extractJson(html, 'ytInitialPlayerResponse');
  const vd = player?.videoDetails;

  if (vd?.videoId && vd.isLiveContent) {
    const lbd = player.microformat?.playerMicroformatRenderer?.liveBroadcastDetails ?? {};
    const scheduled = player.playabilityStatus?.liveStreamability
      ?.liveStreamabilityRenderer?.offlineSlate?.liveStreamOfflineSlateRenderer?.scheduledStartTime;
    if (vd.isLive || lbd.isLiveNow) return live(vd.videoId, vd.title, lbd.startTimestamp);
    if (vd.isUpcoming) return upcoming(vd.videoId, vd.title,
      scheduled ? new Date(Number(scheduled) * 1000).toISOString() : lbd.startTimestamp);
    return { state: 'offline' };
  }

  const data = extractJson(html, 'ytInitialData');
  const primary = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents
    ?.find((c) => c.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
  const videoId = data?.currentVideoEndpoint?.watchEndpoint?.videoId;
  if (videoId && primary?.viewCount?.videoViewCountRenderer?.isLive) {
    const title = primary.title?.runs?.map((r) => r.text).join('') ?? '';
    return live(videoId, title, null);
  }
  return { state: 'offline' };
}

// API mode (YOUTUBE_API_KEY set). Costs ~1.1 quota units per channel per run:
// playlistItems on the uploads playlist, then one videos.list per 50 videos.
// Also returns recent finished broadcasts, so history is useful from day one.
export async function checkChannelsViaApi(channelIds, key) {
  const api = (path, params) => fetch(`https://www.googleapis.com/youtube/v3/${path}?` +
    new URLSearchParams({ ...params, key })).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error?.message ?? `HTTP ${r.status}`);
      return body;
    });

  const recent = {};
  await mapLimit(channelIds, CONCURRENCY, async (id) => {
    try {
      const pl = await api('playlistItems', { part: 'contentDetails', playlistId: 'UU' + id.slice(2), maxResults: 10 });
      recent[id] = pl.items.map((i) => i.contentDetails.videoId);
    } catch (e) { recent[id] = e; }
  });

  const videos = {};
  const allIds = Object.values(recent).filter(Array.isArray).flat();
  for (let i = 0; i < allIds.length; i += 50) {
    const res = await api('videos', { part: 'snippet,liveStreamingDetails', id: allIds.slice(i, i + 50).join(',') });
    for (const v of res.items) videos[v.id] = v;
  }

  const out = {};
  for (const id of channelIds) {
    if (recent[id] instanceof Error) { out[id] = { state: 'error', error: recent[id].message }; continue; }
    const vids = recent[id].map((v) => videos[v]).filter((v) => v?.liveStreamingDetails);
    const now = vids.find((v) => v.snippet.liveBroadcastContent === 'live');
    const next = vids.filter((v) => v.snippet.liveBroadcastContent === 'upcoming')
      .map((v) => upcoming(v.id, v.snippet.title, v.liveStreamingDetails.scheduledStartTime))
      .filter((u) => u.state === 'upcoming')
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0];
    out[id] = now ? live(now.id, now.snippet.title, now.liveStreamingDetails.actualStartTime)
      : next ?? { state: 'offline' };
    out[id].pastBroadcasts = vids.filter((v) => v.liveStreamingDetails.actualEndTime).map((v) => ({
      videoId: v.id, title: v.snippet.title, url: `https://www.youtube.com/watch?v=${v.id}`,
      startedAt: v.liveStreamingDetails.actualStartTime, endedAt: v.liveStreamingDetails.actualEndTime,
    }));
  }
  return out;
}

const video = (videoId, title) => ({
  videoId, title,
  url: `https://www.youtube.com/watch?v=${videoId}`,
  thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
});
const live = (videoId, title, startedAt) => ({ state: 'live', ...video(videoId, title), startedAt: startedAt ?? null });
// Channels often leave abandoned "scheduled" streams up for months; a start
// time more than 2 hours past means it never happened.
const upcoming = (videoId, title, scheduledFor) =>
  scheduledFor && Date.parse(scheduledFor) < Date.now() - 2 * 3600e3
    ? { state: 'offline' }
    : { state: 'upcoming', ...video(videoId, title), scheduledFor: scheduledFor ?? null };

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function main() {
  const channels = JSON.parse(await readFile(CHANNELS, 'utf8'));
  let prev = { channels: {} };
  try { prev = JSON.parse(await readFile(STATUS, 'utf8')); } catch {}

  const now = new Date().toISOString();
  const key = process.env.YOUTUBE_API_KEY;
  const yt = channels.filter((ch) => ch.youtubeChannelId);
  let byChannel = {};
  if (key) {
    try { byChannel = await checkChannelsViaApi(yt.map((ch) => ch.youtubeChannelId), key); }
    catch (e) { console.warn('API mode failed, falling back to page mode:', e.message); }
  }
  const results = await mapLimit(channels, CONCURRENCY, async (ch) => {
    if (!ch.youtubeChannelId) return [ch.id, { state: 'unsupported' }];
    if (byChannel[ch.youtubeChannelId]) return [ch.id, byChannel[ch.youtubeChannelId]];
    try { return [ch.id, await checkChannel(ch.youtubeChannelId)]; }
    catch (e) { return [ch.id, { state: 'error', error: String(e.message ?? e) }]; }
  });
  console.log(`Mode: ${key && Object.keys(byChannel).length ? 'YouTube Data API' : 'public page'}`);

  const next = { generatedAt: now, channels: {} };
  for (const [id, cur] of results) {
    const old = prev.channels?.[id] ?? {};
    const { pastBroadcasts = [], ...curState } = cur;
    let history = [...(old.history ?? [])];
    for (const b of pastBroadcasts) {
      const h = history.find((x) => x.videoId === b.videoId);
      if (h) Object.assign(h, b); else history.push(b);
    }
    history.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    const lastSeen = history[0];

    if (cur.state === 'error' && old.current) {
      // Keep the last good reading rather than flapping to "error".
      next.channels[id] = { ...old, lastError: cur.error, checkedAt: now };
      continue;
    }

    if (curState.state === 'live') {
      if (lastSeen?.videoId === cur.videoId) {
        lastSeen.lastSeenLiveAt = now;
      } else {
        history.unshift({
          videoId: cur.videoId, title: cur.title, url: cur.url,
          startedAt: cur.startedAt ?? now, lastSeenLiveAt: now,
        });
      }
    }
    next.channels[id] = {
      current: curState,
      checkedAt: now,
      lastLiveAt: curState.state === 'live' ? now
        : [old.lastLiveAt, history[0]?.endedAt ?? history[0]?.lastSeenLiveAt].filter(Boolean).sort().pop() ?? null,
      history: history.slice(0, HISTORY_PER_CHANNEL),
    };
  }

  await writeFile(STATUS, JSON.stringify(next, null, 2) + '\n');
  const summary = results.reduce((a, [, r]) => ((a[r.state] = (a[r.state] ?? 0) + 1), a), {});
  console.log(`Checked ${results.length} channels:`, summary);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
