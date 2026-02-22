import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../services/api';
import { Notification } from '../../types';

function Settings() {
  const { user, preferences, logout, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [prefs, setPrefs] = useState({
    minAge: 18,
    maxAge: 50,
    preferredGender: 'any',
    maxDistanceKm: 100,
    lookingFor: 'any',
  });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    if (preferences) {
      setPrefs({
        minAge: preferences.minAge,
        maxAge: preferences.maxAge,
        preferredGender: preferences.preferredGender,
        maxDistanceKm: preferences.maxDistanceKm,
        lookingFor: preferences.lookingFor,
      });
    }
  }, [preferences]);

  const loadNotifications = async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data.notifications);
      await api.markNotificationsRead();
    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  };

  const loadBlockedUsers = async () => {
    try {
      const data = await api.getBlockedUsers();
      setBlockedUsers(data.blockedUsers);
    } catch (err) {
      console.error('Failed to load blocked users:', err);
    }
  };

  const handleSavePreferences = async () => {
    setSaving(true);
    try {
      await api.updatePreferences(prefs);
      await refreshUser();
      alert('Preferences saved!');
    } catch (err: any) {
      alert(err.message || 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleUnblock = async (userId: string) => {
    try {
      await api.unblockUser(userId);
      setBlockedUsers((prev) => prev.filter((b) => b.userId !== userId));
    } catch (err) {
      console.error('Failed to unblock:', err);
    }
  };

  const handleDeactivate = async () => {
    if (!window.confirm('Are you sure you want to deactivate your account? Your profile will be hidden from other users.')) {
      return;
    }
    try {
      await api.deactivateAccount();
      logout();
    } catch (err) {
      console.error('Failed to deactivate:', err);
    }
  };

  const toggleSection = (section: string) => {
    if (activeSection === section) {
      setActiveSection(null);
    } else {
      setActiveSection(section);
      if (section === 'notifications') loadNotifications();
      if (section === 'blocked') loadBlockedUsers();
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div style={styles.content}>
        {/* Discovery Preferences */}
        <div style={styles.settingsGroup}>
          <button
            style={styles.settingsGroupHeader}
            onClick={() => toggleSection('preferences')}
          >
            <span style={styles.settingsIcon}>&#9881;</span>
            <span style={styles.settingsLabel}>Discovery Preferences</span>
            <span style={styles.arrow}>{activeSection === 'preferences' ? '&#9650;' : '&#9660;'}</span>
          </button>

          {activeSection === 'preferences' && (
            <div style={styles.settingsBody}>
              <div className="form-group">
                <label className="form-label">Age Range</label>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <input
                    type="number"
                    className="form-input"
                    value={prefs.minAge}
                    onChange={(e) => setPrefs((p) => ({ ...p, minAge: parseInt(e.target.value) || 18 }))}
                    min={18}
                    max={99}
                    style={{ width: '80px' }}
                  />
                  <span>to</span>
                  <input
                    type="number"
                    className="form-input"
                    value={prefs.maxAge}
                    onChange={(e) => setPrefs((p) => ({ ...p, maxAge: parseInt(e.target.value) || 99 }))}
                    min={18}
                    max={99}
                    style={{ width: '80px' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Show Me</label>
                <select
                  className="form-select"
                  value={prefs.preferredGender}
                  onChange={(e) => setPrefs((p) => ({ ...p, preferredGender: e.target.value }))}
                >
                  <option value="any">Everyone</option>
                  <option value="male">Men</option>
                  <option value="female">Women</option>
                  <option value="non-binary">Non-binary</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Maximum Distance: {prefs.maxDistanceKm} km</label>
                <input
                  type="range"
                  min={1}
                  max={500}
                  value={prefs.maxDistanceKm}
                  onChange={(e) => setPrefs((p) => ({ ...p, maxDistanceKm: parseInt(e.target.value) }))}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Looking For</label>
                <select
                  className="form-select"
                  value={prefs.lookingFor}
                  onChange={(e) => setPrefs((p) => ({ ...p, lookingFor: e.target.value }))}
                >
                  <option value="any">Anything</option>
                  <option value="relationship">Relationship</option>
                  <option value="casual">Casual</option>
                  <option value="friendship">Friendship</option>
                </select>
              </div>

              <button
                className="btn btn-primary btn-block"
                onClick={handleSavePreferences}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          )}
        </div>

        {/* Notifications */}
        <div style={styles.settingsGroup}>
          <button
            style={styles.settingsGroupHeader}
            onClick={() => toggleSection('notifications')}
          >
            <span style={styles.settingsIcon}>&#128276;</span>
            <span style={styles.settingsLabel}>Notifications</span>
            <span style={styles.arrow}>{activeSection === 'notifications' ? '&#9650;' : '&#9660;'}</span>
          </button>

          {activeSection === 'notifications' && (
            <div style={styles.settingsBody}>
              {notifications.length === 0 ? (
                <p style={styles.emptyText}>No notifications yet</p>
              ) : (
                notifications.map((notif) => (
                  <div key={notif.id} style={styles.notifItem}>
                    <div style={styles.notifIcon}>
                      {notif.type === 'match' ? '❤️' : notif.type === 'message' ? '💬' : '⭐'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={styles.notifTitle}>{notif.title}</p>
                      <p style={styles.notifBody}>{notif.body}</p>
                      <p style={styles.notifTime}>
                        {new Date(notif.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Blocked Users */}
        <div style={styles.settingsGroup}>
          <button
            style={styles.settingsGroupHeader}
            onClick={() => toggleSection('blocked')}
          >
            <span style={styles.settingsIcon}>&#128683;</span>
            <span style={styles.settingsLabel}>Blocked Users</span>
            <span style={styles.arrow}>{activeSection === 'blocked' ? '&#9650;' : '&#9660;'}</span>
          </button>

          {activeSection === 'blocked' && (
            <div style={styles.settingsBody}>
              {blockedUsers.length === 0 ? (
                <p style={styles.emptyText}>No blocked users</p>
              ) : (
                blockedUsers.map((blocked) => (
                  <div key={blocked.userId} style={styles.blockedItem}>
                    <div
                      style={{
                        ...styles.blockedAvatar,
                        backgroundImage: blocked.photoUrl ? `url(${blocked.photoUrl})` : undefined,
                      }}
                    />
                    <span style={{ flex: 1, fontWeight: '500' }}>{blocked.displayName}</span>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleUnblock(blocked.userId)}
                    >
                      Unblock
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Account Actions */}
        <div style={styles.settingsGroup}>
          <button style={styles.settingsGroupHeader} onClick={() => toggleSection('account')}>
            <span style={styles.settingsIcon}>&#128100;</span>
            <span style={styles.settingsLabel}>Account</span>
            <span style={styles.arrow}>{activeSection === 'account' ? '&#9650;' : '&#9660;'}</span>
          </button>

          {activeSection === 'account' && (
            <div style={styles.settingsBody}>
              <div style={styles.accountInfo}>
                <p><strong>Email:</strong> {user?.email}</p>
                <p><strong>Member since:</strong> {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</p>
                <p><strong>Plan:</strong> {user?.isPremium ? 'Premium' : 'Free'}</p>
              </div>

              <button
                className="btn btn-secondary btn-block mb-2"
                onClick={() => navigate('/profile/edit')}
              >
                Edit Profile
              </button>

              <button
                className="btn btn-outline btn-block mb-2"
                onClick={logout}
              >
                Log Out
              </button>

              <button
                className="btn btn-danger btn-block"
                onClick={handleDeactivate}
              >
                Deactivate Account
              </button>
            </div>
          )}
        </div>

        {/* App Info */}
        <div style={styles.appInfo}>
          <p style={{ fontWeight: '700', color: '#e94057' }}>Spark</p>
          <p style={{ color: '#b2bec3', fontSize: '13px' }}>Version 1.0.0</p>
          <p style={{ color: '#b2bec3', fontSize: '12px', marginTop: '8px' }}>
            Made with &#10084; for meaningful connections
          </p>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  content: {
    padding: '0 16px 100px',
  },
  settingsGroup: {
    background: 'white',
    borderRadius: '16px',
    marginBottom: '12px',
    overflow: 'hidden',
    border: '1px solid #f1f2f6',
  },
  settingsGroupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    padding: '16px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    textAlign: 'left',
  },
  settingsIcon: {
    fontSize: '20px',
    width: '28px',
    textAlign: 'center',
  },
  settingsLabel: {
    flex: 1,
    fontWeight: '600',
    color: '#2d3436',
  },
  arrow: {
    color: '#b2bec3',
    fontSize: '12px',
  },
  settingsBody: {
    padding: '0 16px 16px',
    borderTop: '1px solid #f1f2f6',
    paddingTop: '16px',
  },
  emptyText: {
    color: '#636e72',
    fontSize: '14px',
    textAlign: 'center',
    padding: '16px 0',
  },
  notifItem: {
    display: 'flex',
    gap: '12px',
    padding: '12px 0',
    borderBottom: '1px solid #f1f2f6',
  },
  notifIcon: {
    fontSize: '20px',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifTitle: {
    fontWeight: '600',
    fontSize: '14px',
    color: '#2d3436',
    margin: 0,
  },
  notifBody: {
    fontSize: '13px',
    color: '#636e72',
    margin: '2px 0 0',
  },
  notifTime: {
    fontSize: '11px',
    color: '#b2bec3',
    margin: '4px 0 0',
  },
  blockedItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 0',
    borderBottom: '1px solid #f1f2f6',
  },
  blockedAvatar: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundColor: '#dfe6e9',
  },
  accountInfo: {
    padding: '12px 0 16px',
    fontSize: '14px',
    lineHeight: '2',
    color: '#636e72',
  },
  appInfo: {
    textAlign: 'center',
    padding: '32px 0',
  },
};

export default Settings;
