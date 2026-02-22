import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const primaryPhoto = user.photos?.find((p) => p.is_primary || p.isPrimary);
  const photoUrl = primaryPhoto?.url || (user.photos?.length > 0 ? user.photos[0].url : null);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Profile</h1>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => navigate('/profile/edit')}
        >
          Edit
        </button>
      </div>

      <div style={styles.profileCard}>
        {/* Photo */}
        <div
          style={{
            ...styles.photoContainer,
            backgroundImage: photoUrl ? `url(${photoUrl})` : undefined,
            backgroundColor: photoUrl ? undefined : '#dfe6e9',
          }}
        >
          {!photoUrl && (
            <div style={styles.noPhoto}>
              <span style={{ fontSize: '48px' }}>&#128247;</span>
              <p>Add a photo to get started</p>
            </div>
          )}
          <div style={styles.photoOverlay}>
            <h2 style={styles.nameTag}>
              {user.displayName}, {user.age}
            </h2>
          </div>
        </div>

        {/* Info section */}
        <div style={styles.infoSection}>
          {user.occupation && (
            <div style={styles.infoRow}>
              <span style={styles.infoIcon}>&#128188;</span>
              <span>{user.occupation}</span>
            </div>
          )}
          {user.education && (
            <div style={styles.infoRow}>
              <span style={styles.infoIcon}>&#127891;</span>
              <span>{user.education}</span>
            </div>
          )}
          {user.locationCity && (
            <div style={styles.infoRow}>
              <span style={styles.infoIcon}>&#128205;</span>
              <span>{user.locationCity}{user.locationState ? `, ${user.locationState}` : ''}</span>
            </div>
          )}
          {user.heightCm && (
            <div style={styles.infoRow}>
              <span style={styles.infoIcon}>&#128207;</span>
              <span>{user.heightCm}cm</span>
            </div>
          )}
          {user.lookingFor && (
            <div style={styles.infoRow}>
              <span style={styles.infoIcon}>&#128149;</span>
              <span>Looking for: {user.lookingFor}</span>
            </div>
          )}
        </div>

        {/* Bio */}
        {user.bio && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>About Me</h3>
            <p style={styles.bio}>{user.bio}</p>
          </div>
        )}

        {/* Interests */}
        {user.interests && user.interests.length > 0 && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Interests</h3>
            <div style={styles.tags}>
              {user.interests.map((interest) => (
                <span key={interest.id} className="tag tag-primary">
                  {interest.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Photos grid */}
        {user.photos && user.photos.length > 0 && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Photos ({user.photos.length}/6)</h3>
            <div style={styles.photoGrid}>
              {user.photos.map((photo) => (
                <div
                  key={photo.id}
                  style={{
                    ...styles.gridPhoto,
                    backgroundImage: `url(${photo.url})`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Profile completeness */}
        {!user.profileComplete && (
          <div style={styles.completenessCard}>
            <h4 style={{ fontWeight: '700', marginBottom: '8px' }}>Complete your profile</h4>
            <p style={{ fontSize: '14px', color: '#636e72', marginBottom: '12px' }}>
              Add photos and fill in your bio to get more matches
            </p>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/profile/edit')}
            >
              Complete Profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  profileCard: {
    padding: '0 16px 24px',
  },
  photoContainer: {
    position: 'relative',
    width: '100%',
    height: '360px',
    borderRadius: '20px',
    overflow: 'hidden',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noPhoto: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    color: '#636e72',
  },
  photoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '40px 16px 16px',
    background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
  },
  nameTag: {
    color: 'white',
    fontSize: '24px',
    fontWeight: '700',
  },
  infoSection: {
    padding: '16px 0',
  },
  infoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 0',
    fontSize: '15px',
    color: '#2d3436',
  },
  infoIcon: {
    fontSize: '18px',
    width: '24px',
    textAlign: 'center' as const,
  },
  section: {
    paddingTop: '16px',
    borderTop: '1px solid #f1f2f6',
    marginTop: '8px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '700',
    marginBottom: '12px',
    color: '#2d3436',
  },
  bio: {
    fontSize: '15px',
    lineHeight: '1.6',
    color: '#636e72',
  },
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
  },
  gridPhoto: {
    aspectRatio: '1',
    borderRadius: '12px',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundColor: '#f1f2f6',
  },
  completenessCard: {
    marginTop: '20px',
    padding: '20px',
    background: 'linear-gradient(135deg, rgba(233, 64, 87, 0.08), rgba(138, 43, 226, 0.08))',
    borderRadius: '16px',
    border: '1px solid rgba(233, 64, 87, 0.15)',
  },
};

export default Profile;
