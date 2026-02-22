import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { useSocketEvent, useSocketEmit } from '../../hooks/useSocket';
import { Message, Match } from '../../types';

function Chat() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const emit = useSocketEmit();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [matchInfo, setMatchInfo] = useState<Match | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Load messages and match info
  useEffect(() => {
    if (!matchId) return;

    const loadData = async () => {
      try {
        const [messagesData, matchesData] = await Promise.all([
          api.getMessages(matchId),
          api.getMatches(),
        ]);
        setMessages(messagesData.messages);
        const match = matchesData.matches.find((m: Match) => m.matchId === matchId);
        setMatchInfo(match || null);

        // Mark as read
        emit('mark_read', { matchId });
      } catch (err) {
        console.error('Failed to load chat:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [matchId, emit]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for new messages via socket
  const handleNewMessage = useCallback((msg: Message) => {
    if (msg.matchId === matchId) {
      setMessages((prev) => [...prev, msg]);
      // Mark as read immediately if it's from the other person
      if (!msg.isOwn) {
        emit('mark_read', { matchId });
      }
    }
  }, [matchId, emit]);

  useSocketEvent('new_message', handleNewMessage);

  // Typing indicators
  const handleTypingStart = useCallback((data: { matchId: string }) => {
    if (data.matchId === matchId) setTyping(true);
  }, [matchId]);

  const handleTypingStop = useCallback((data: { matchId: string }) => {
    if (data.matchId === matchId) setTyping(false);
  }, [matchId]);

  useSocketEvent('typing_start', handleTypingStart);
  useSocketEvent('typing_stop', handleTypingStop);

  const handleInputChange = (value: string) => {
    setInput(value);

    // Emit typing indicator
    emit('typing_start', { matchId });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      emit('typing_stop', { matchId });
    }, 2000);
  };

  const handleSend = async () => {
    if (!input.trim() || !matchId || sending) return;

    const content = input.trim();
    setInput('');
    setSending(true);

    // Clear typing indicator
    emit('typing_stop', { matchId });

    try {
      // Send via socket for real-time delivery
      emit('send_message', { matchId, content });

      // Also send via REST API as fallback
      await api.sendMessage(matchId, content);
    } catch (err) {
      console.error('Failed to send message:', err);
      setInput(content); // Restore input on failure
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleUnmatch = async () => {
    if (!matchId) return;
    if (!window.confirm('Are you sure you want to unmatch? This cannot be undone.')) return;

    try {
      await api.unmatch(matchId);
      navigate('/matches');
    } catch (err) {
      console.error('Failed to unmatch:', err);
    }
  };

  const handleBlock = async () => {
    if (!matchInfo) return;
    if (!window.confirm(`Block ${matchInfo.user.displayName}? They won't be able to see or contact you.`)) return;

    try {
      await api.blockUser(matchInfo.user.id);
      navigate('/matches');
    } catch (err) {
      console.error('Failed to block:', err);
    }
  };

  const handleReport = async () => {
    if (!matchInfo) return;
    const reason = window.prompt(
      'Why are you reporting this user?\n\nOptions: harassment, spam, fake_profile, inappropriate_photos, other'
    );
    if (!reason) return;

    try {
      await api.reportUser(matchInfo.user.id, reason as any);
      alert('Report submitted. Thank you for helping keep Spark safe.');
    } catch (err: any) {
      alert(err.message || 'Failed to submit report');
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Chat Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/matches')}>
          &#8592;
        </button>
        <div style={styles.headerInfo}>
          <div
            style={{
              ...styles.headerAvatar,
              backgroundImage: matchInfo?.user.photoUrl ? `url(${matchInfo.user.photoUrl})` : undefined,
              backgroundColor: matchInfo?.user.photoUrl ? undefined : '#dfe6e9',
            }}
          />
          <div>
            <h3 style={styles.headerName}>
              {matchInfo?.user.displayName || 'Unknown'}
            </h3>
            {typing && <span style={styles.typingIndicator}>typing...</span>}
          </div>
        </div>
        <button
          style={styles.menuBtn}
          onClick={() => setShowActions(!showActions)}
        >
          &#8942;
        </button>
      </div>

      {/* Actions dropdown */}
      {showActions && (
        <div style={styles.actionsDropdown}>
          <button style={styles.actionItem} onClick={handleUnmatch}>
            Unmatch
          </button>
          <button style={styles.actionItem} onClick={handleBlock}>
            Block User
          </button>
          <button style={{ ...styles.actionItem, color: '#ff4757' }} onClick={handleReport}>
            Report User
          </button>
        </div>
      )}

      {/* Messages */}
      <div style={styles.messagesContainer} onClick={() => setShowActions(false)}>
        {messages.length === 0 && (
          <div style={styles.emptyChat}>
            <p style={{ fontSize: '40px' }}>&#128075;</p>
            <p style={{ color: '#636e72' }}>
              Say hi to {matchInfo?.user.displayName}!
            </p>
          </div>
        )}

        {messages.map((msg, index) => {
          const showDate = index === 0 ||
            new Date(msg.createdAt).toDateString() !==
            new Date(messages[index - 1].createdAt).toDateString();

          return (
            <div key={msg.id}>
              {showDate && (
                <div style={styles.dateDivider}>
                  <span style={styles.dateText}>
                    {new Date(msg.createdAt).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              )}
              <div style={{
                ...styles.messageBubbleWrapper,
                justifyContent: msg.isOwn ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  ...styles.messageBubble,
                  ...(msg.isOwn ? styles.ownMessage : styles.otherMessage),
                }}>
                  <p style={styles.messageText}>{msg.content}</p>
                  <span style={{
                    ...styles.messageTime,
                    color: msg.isOwn ? 'rgba(255,255,255,0.7)' : '#b2bec3',
                  }}>
                    {new Date(msg.createdAt).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {msg.isOwn && (
                      <span style={{ marginLeft: '4px' }}>
                        {msg.isRead ? '✓✓' : '✓'}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {typing && (
          <div style={{ ...styles.messageBubbleWrapper, justifyContent: 'flex-start' }}>
            <div style={{ ...styles.messageBubble, ...styles.otherMessage }}>
              <span style={styles.typingDots}>• • •</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={styles.inputArea}>
        <input
          ref={inputRef}
          type="text"
          style={styles.messageInput}
          placeholder="Type a message..."
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyPress}
          maxLength={2000}
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: input.trim() ? 1 : 0.5,
          }}
          onClick={handleSend}
          disabled={!input.trim() || sending}
        >
          &#10148;
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#f8f9fa',
  },
  loadingContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: 'white',
    borderBottom: '1px solid #f1f2f6',
    position: 'relative',
    zIndex: 10,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    padding: '8px',
    cursor: 'pointer',
    color: '#2d3436',
  },
  headerInfo: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  headerAvatar: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  },
  headerName: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#2d3436',
  },
  typingIndicator: {
    fontSize: '12px',
    color: '#e94057',
    fontStyle: 'italic',
  },
  menuBtn: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    padding: '8px',
    cursor: 'pointer',
    color: '#636e72',
  },
  actionsDropdown: {
    position: 'absolute',
    top: '60px',
    right: '16px',
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
    zIndex: 20,
    overflow: 'hidden',
    minWidth: '160px',
  },
  actionItem: {
    display: 'block',
    width: '100%',
    padding: '12px 16px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid #f1f2f6',
    fontSize: '15px',
    color: '#2d3436',
    textAlign: 'left',
    cursor: 'pointer',
  },
  messagesContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  emptyChat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: '8px',
    paddingTop: '40px',
  },
  dateDivider: {
    display: 'flex',
    justifyContent: 'center',
    padding: '16px 0 8px',
  },
  dateText: {
    fontSize: '12px',
    color: '#b2bec3',
    background: '#f1f2f6',
    padding: '4px 12px',
    borderRadius: '12px',
  },
  messageBubbleWrapper: {
    display: 'flex',
    padding: '2px 0',
  },
  messageBubble: {
    maxWidth: '75%',
    padding: '10px 14px',
    borderRadius: '18px',
  },
  ownMessage: {
    background: 'linear-gradient(135deg, #e94057, #8a2be2)',
    color: 'white',
    borderBottomRightRadius: '4px',
  },
  otherMessage: {
    background: 'white',
    color: '#2d3436',
    borderBottomLeftRadius: '4px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  messageText: {
    fontSize: '15px',
    lineHeight: '1.4',
    margin: 0,
    wordBreak: 'break-word',
  },
  messageTime: {
    fontSize: '11px',
    marginTop: '4px',
    display: 'block',
    textAlign: 'right',
  },
  typingDots: {
    color: '#636e72',
    fontSize: '18px',
    letterSpacing: '2px',
    animation: 'pulse 1.5s infinite',
  },
  inputArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    background: 'white',
    borderTop: '1px solid #f1f2f6',
  },
  messageInput: {
    flex: 1,
    padding: '12px 16px',
    border: '2px solid #f1f2f6',
    borderRadius: '24px',
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  sendBtn: {
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #e94057, #8a2be2)',
    color: 'white',
    border: 'none',
    fontSize: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
};

export default Chat;
