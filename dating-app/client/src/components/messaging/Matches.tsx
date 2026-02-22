import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { Match } from '../../types';

function Matches() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMatches();
  }, []);

  const loadMatches = async () => {
    try {
      const data = await api.getMatches();
      setMatches(data.matches);
    } catch (err) {
      console.error('Failed to load matches:', err);
    } finally {
      setLoading(false);
    }
  };

  // Separate new matches (no messages) and conversations (has messages)
  const newMatches = matches.filter((m) => !m.lastMessage);
  const conversations = matches
    .filter((m) => m.lastMessage)
    .sort((a, b) => {
      const aTime = a.lastMessage?.createdAt || a.matchedAt;
      const bTime = b.lastMessage?.createdAt || b.matchedAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Matches</h1>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Matches</h1>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#128140;</div>
          <h3 className="empty-state-title">No matches yet</h3>
          <p className="empty-state-text">
            Keep swiping to find your matches! When someone likes you back, they'll show up here
          </p>
          <button className="btn btn-primary mt-3" onClick={() => navigate('/')}>
            Start Discovering
          </button>
        </div>
      ) : (
        <div style={styles.content}>
          {/* New Matches Row */}
          {newMatches.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>New Matches</h3>
              <div style={styles.newMatchesRow}>
                {newMatches.map((match) => (
                  <button
                    key={match.matchId}
                    style={styles.newMatchItem}
                    onClick={() => navigate(`/chat/${match.matchId}`)}
                  >
                    <div
                      style={{
                        ...styles.newMatchPhoto,
                        backgroundImage: match.user.photoUrl ? `url(${match.user.photoUrl})` : undefined,
                        backgroundColor: match.user.photoUrl ? undefined : '#dfe6e9',
                      }}
                    >
                      {!match.user.photoUrl && (
                        <span style={{ fontSize: '24px' }}>&#128100;</span>
                      )}
                    </div>
                    <span style={styles.newMatchName}>{match.user.displayName.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversations */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Messages</h3>
            {conversations.length === 0 ? (
              <p style={styles.emptyText}>
                Send a message to one of your matches to start a conversation!
              </p>
            ) : (
              <div style={styles.conversationList}>
                {conversations.map((match) => (
                  <button
                    key={match.matchId}
                    style={styles.conversationItem}
                    onClick={() => navigate(`/chat/${match.matchId}`)}
                  >
                    <div
                      style={{
                        ...styles.avatar,
                        backgroundImage: match.user.photoUrl ? `url(${match.user.photoUrl})` : undefined,
                        backgroundColor: match.user.photoUrl ? undefined : '#dfe6e9',
                      }}
                    >
                      {!match.user.photoUrl && (
                        <span style={{ fontSize: '20px' }}>&#128100;</span>
                      )}
                    </div>
                    <div style={styles.conversationInfo}>
                      <div style={styles.conversationHeader}>
                        <span style={styles.conversationName}>
                          {match.user.displayName}
                        </span>
                        <span style={styles.conversationTime}>
                          {formatTime(match.lastMessage?.createdAt || match.matchedAt)}
                        </span>
                      </div>
                      <p style={{
                        ...styles.lastMessage,
                        fontWeight: match.unreadCount > 0 ? '600' : '400',
                        color: match.unreadCount > 0 ? '#2d3436' : '#636e72',
                      }}>
                        {match.lastMessage?.isOwn ? 'You: ' : ''}
                        {match.lastMessage?.content || 'New match!'}
                      </p>
                    </div>
                    {match.unreadCount > 0 && (
                      <span style={styles.unreadBadge}>{match.unreadCount}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}

const styles: Record<string, React.CSSProperties> = {
  content: {
    padding: '0 16px',
  },
  section: {
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#636e72',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '12px',
  },
  newMatchesRow: {
    display: 'flex',
    gap: '16px',
    overflowX: 'auto',
    paddingBottom: '8px',
  },
  newMatchItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    minWidth: '72px',
  },
  newMatchPhoto: {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    border: '3px solid #e94057',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newMatchName: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#2d3436',
  },
  conversationList: {
    display: 'flex',
    flexDirection: 'column',
  },
  conversationItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 0',
    borderBottom: '1px solid #f1f2f6',
    background: 'none',
    border: 'none',
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
    borderBottomColor: '#f1f2f6',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
  },
  avatar: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  conversationInfo: {
    flex: 1,
    minWidth: 0,
  },
  conversationHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  },
  conversationName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#2d3436',
  },
  conversationTime: {
    fontSize: '12px',
    color: '#b2bec3',
  },
  lastMessage: {
    fontSize: '14px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    margin: 0,
  },
  unreadBadge: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    background: '#e94057',
    color: 'white',
    fontSize: '11px',
    fontWeight: '700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  emptyText: {
    color: '#636e72',
    fontSize: '14px',
    textAlign: 'center',
    padding: '20px 0',
  },
};

export default Matches;
