import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { DiscoveryProfile } from '../../types';

function Discovery() {
  const [profiles, setProfiles] = useState<DiscoveryProfile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  const [matchPopup, setMatchPopup] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  const loadProfiles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getDiscovery(20);
      setProfiles(data.profiles);
      setCurrentIndex(0);
      setPhotoIndex(0);
    } catch (err) {
      console.error('Failed to load profiles:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const handleSwipe = async (direction: 'like' | 'pass' | 'superlike') => {
    if (swiping || currentIndex >= profiles.length) return;
    setSwiping(true);

    const profile = profiles[currentIndex];

    try {
      const result = await api.swipe(profile.id, direction);
      if (result.isMatch) {
        setMatchPopup(profile.displayName);
        setTimeout(() => setMatchPopup(null), 3000);
      }

      setCurrentIndex((prev) => prev + 1);
      setPhotoIndex(0);
      setShowDetails(false);

      // Load more if running low
      if (currentIndex >= profiles.length - 3) {
        const moreData = await api.getDiscovery(20, profiles.length);
        if (moreData.profiles.length > 0) {
          setProfiles((prev) => [...prev, ...moreData.profiles]);
        }
      }
    } catch (err: any) {
      console.error('Swipe failed:', err);
    } finally {
      setSwiping(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Discover</h1>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  const profile = profiles[currentIndex];

  if (!profile) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Discover</h1>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">&#128149;</div>
          <h3 className="empty-state-title">No more profiles</h3>
          <p className="empty-state-text">
            Check back later for new people in your area, or adjust your preferences
          </p>
          <button className="btn btn-primary mt-3" onClick={loadProfiles}>
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const photoUrl = profile.photos.length > 0
    ? profile.photos[Math.min(photoIndex, profile.photos.length - 1)]?.url
    : null;

  return (
    <div style={styles.container}>
      {/* Match popup overlay */}
      {matchPopup && (
        <div style={styles.matchOverlay}>
          <div style={styles.matchPopup}>
            <div style={{ fontSize: '48px' }}>&#127881;</div>
            <h2 style={{ fontSize: '28px', fontWeight: '800' }}>It's a Match!</h2>
            <p style={{ color: '#ffffff99' }}>You and {matchPopup} liked each other</p>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">Discover</h1>
        <span style={styles.counter}>
          {profiles.length - currentIndex} profiles
        </span>
      </div>

      {/* Profile Card */}
      <div style={styles.cardWrapper}>
        <div style={styles.card}>
          {/* Photo area */}
          <div
            style={{
              ...styles.photoArea,
              backgroundImage: photoUrl ? `url(${photoUrl})` : undefined,
              backgroundColor: photoUrl ? undefined : '#dfe6e9',
            }}
          >
            {!photoUrl && (
              <div style={styles.noPhoto}>
                <span style={{ fontSize: '48px' }}>&#128100;</span>
                <span>No photos yet</span>
              </div>
            )}

            {/* Photo navigation dots */}
            {profile.photos.length > 1 && (
              <div style={styles.photoDots}>
                {profile.photos.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      ...styles.dot,
                      opacity: i === photoIndex ? 1 : 0.5,
                    }}
                  />
                ))}
              </div>
            )}

            {/* Photo navigation tap areas */}
            {profile.photos.length > 1 && (
              <>
                <div
                  style={{ ...styles.photoNav, left: 0 }}
                  onClick={() => setPhotoIndex(Math.max(0, photoIndex - 1))}
                />
                <div
                  style={{ ...styles.photoNav, right: 0 }}
                  onClick={() => setPhotoIndex(Math.min(profile.photos.length - 1, photoIndex + 1))}
                />
              </>
            )}

            {/* Gradient overlay at bottom */}
            <div style={styles.gradientOverlay} />

            {/* Basic info overlay */}
            <div style={styles.infoOverlay}>
              <h2 style={styles.name}>
                {profile.displayName}, {profile.age}
              </h2>
              {profile.occupation && (
                <p style={styles.occupation}>{profile.occupation}</p>
              )}
              {profile.locationCity && (
                <p style={styles.location}>
                  &#128205; {profile.locationCity}{profile.locationState ? `, ${profile.locationState}` : ''}
                </p>
              )}
              {profile.compatibilityScore > 0 && (
                <span style={styles.compatibility}>
                  {profile.compatibilityScore}% match
                </span>
              )}
            </div>
          </div>

          {/* Expandable details */}
          <div style={styles.details}>
            <button
              style={styles.expandBtn}
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? 'Less info' : 'More info'}
              <span style={{ transform: showDetails ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>
                &#9660;
              </span>
            </button>

            {showDetails && (
              <div style={styles.detailsContent}>
                {profile.bio && (
                  <p style={styles.bio}>{profile.bio}</p>
                )}
                {profile.education && (
                  <p style={styles.detailRow}>
                    &#127891; {profile.education}
                  </p>
                )}
                {profile.heightCm && (
                  <p style={styles.detailRow}>
                    &#128207; {Math.floor(profile.heightCm / 30.48)}'{Math.round((profile.heightCm % 30.48) / 2.54)}"
                    ({profile.heightCm}cm)
                  </p>
                )}
                {profile.lookingFor && (
                  <p style={styles.detailRow}>
                    &#128149; Looking for: {profile.lookingFor}
                  </p>
                )}

                {profile.interests.length > 0 && (
                  <div style={styles.interests}>
                    {profile.interests.map((interest) => (
                      <span
                        key={interest.id}
                        className={`tag ${
                          profile.sharedInterests.some((si) => si.id === interest.id)
                            ? 'tag-primary'
                            : ''
                        }`}
                      >
                        {interest.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={styles.actions}>
        <button
          style={{ ...styles.actionBtn, ...styles.passBtn }}
          onClick={() => handleSwipe('pass')}
          disabled={swiping}
          title="Pass"
        >
          &#10005;
        </button>
        <button
          style={{ ...styles.actionBtn, ...styles.superlikeBtn }}
          onClick={() => handleSwipe('superlike')}
          disabled={swiping}
          title="Super Like"
        >
          &#9733;
        </button>
        <button
          style={{ ...styles.actionBtn, ...styles.likeBtn }}
          onClick={() => handleSwipe('like')}
          disabled={swiping}
          title="Like"
        >
          &#10084;
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    paddingBottom: '16px',
  },
  counter: {
    fontSize: '13px',
    color: '#636e72',
    fontWeight: '500',
  },
  cardWrapper: {
    padding: '0 16px',
  },
  card: {
    borderRadius: '20px',
    overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
    background: 'white',
  },
  photoArea: {
    position: 'relative',
    width: '100%',
    height: '420px',
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
  photoDots: {
    position: 'absolute',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '4px',
    zIndex: 2,
  },
  dot: {
    width: '32px',
    height: '4px',
    borderRadius: '2px',
    background: 'white',
    transition: 'opacity 0.2s',
  },
  photoNav: {
    position: 'absolute',
    top: 0,
    width: '50%',
    height: '100%',
    zIndex: 1,
    cursor: 'pointer',
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '200px',
    background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
    pointerEvents: 'none',
  },
  infoOverlay: {
    position: 'absolute',
    bottom: '16px',
    left: '16px',
    right: '16px',
    color: 'white',
    zIndex: 2,
  },
  name: {
    fontSize: '26px',
    fontWeight: '700',
    marginBottom: '4px',
    textShadow: '0 1px 4px rgba(0,0,0,0.3)',
  },
  occupation: {
    fontSize: '15px',
    opacity: 0.9,
  },
  location: {
    fontSize: '14px',
    opacity: 0.8,
    marginTop: '2px',
  },
  compatibility: {
    display: 'inline-block',
    marginTop: '8px',
    padding: '4px 12px',
    background: 'rgba(255,255,255,0.2)',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '600',
    backdropFilter: 'blur(4px)',
  },
  details: {
    padding: '12px 16px',
  },
  expandBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'none',
    border: 'none',
    color: '#636e72',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  detailsContent: {
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #f1f2f6',
  },
  bio: {
    fontSize: '15px',
    lineHeight: '1.5',
    color: '#2d3436',
    marginBottom: '12px',
  },
  detailRow: {
    fontSize: '14px',
    color: '#636e72',
    marginBottom: '6px',
  },
  interests: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '12px',
  },
  actions: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '20px',
    padding: '20px',
  },
  actionBtn: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
    transition: 'transform 0.2s, box-shadow 0.2s',
  },
  passBtn: {
    background: 'white',
    color: '#ff4757',
  },
  superlikeBtn: {
    background: 'white',
    color: '#3498db',
    width: '48px',
    height: '48px',
    fontSize: '20px',
  },
  likeBtn: {
    background: 'linear-gradient(135deg, #e94057, #8a2be2)',
    color: 'white',
  },
  matchOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    animation: 'fadeIn 0.3s',
  },
  matchPopup: {
    textAlign: 'center' as const,
    color: 'white',
    padding: '40px',
  },
};

export default Discovery;
