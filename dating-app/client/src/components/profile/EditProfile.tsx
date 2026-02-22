import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../services/api';
import { Interest } from '../../types';

function EditProfile() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    displayName: '',
    bio: '',
    locationCity: '',
    locationState: '',
    occupation: '',
    education: '',
    heightCm: '' as string | number,
    lookingFor: 'relationship',
  });
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [allInterests, setAllInterests] = useState<Interest[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (user) {
      setForm({
        displayName: user.displayName || '',
        bio: user.bio || '',
        locationCity: user.locationCity || '',
        locationState: user.locationState || '',
        occupation: user.occupation || '',
        education: user.education || '',
        heightCm: user.heightCm || '',
        lookingFor: user.lookingFor || 'relationship',
      });
      setSelectedInterests(user.interests?.map((i) => i.id) || []);
    }
  }, [user]);

  useEffect(() => {
    api.getInterests().then((data) => setAllInterests(data.interests)).catch(() => {});
  }, []);

  const updateForm = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleInterest = (id: string) => {
    setSelectedInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : prev.length < 10 ? [...prev, id] : prev
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await api.updateProfile({
        ...form,
        heightCm: form.heightCm ? Number(form.heightCm) : null,
        interests: selectedInterests,
      });
      await refreshUser();
      setSuccess('Profile updated!');
      setTimeout(() => navigate('/profile'), 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError('');

    try {
      await api.uploadPhoto(file);
      await refreshUser();
    } catch (err: any) {
      setError(err.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    try {
      await api.deletePhoto(photoId);
      await refreshUser();
    } catch (err: any) {
      setError(err.message || 'Failed to delete photo');
    }
  };

  if (!user) return null;

  // Group interests by category
  const interestsByCategory: Record<string, Interest[]> = {};
  allInterests.forEach((interest) => {
    if (!interestsByCategory[interest.category]) {
      interestsByCategory[interest.category] = [];
    }
    interestsByCategory[interest.category].push(interest);
  });

  return (
    <div>
      <div className="page-header">
        <button style={styles.backBtn} onClick={() => navigate('/profile')}>
          &#8592; Back
        </button>
        <h1 className="page-title">Edit Profile</h1>
        <div style={{ width: '60px' }} />
      </div>

      <div style={styles.content}>
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {/* Photos Section */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Photos</h3>
          <div style={styles.photoGrid}>
            {user.photos?.map((photo) => (
              <div key={photo.id} style={styles.photoItem}>
                <div
                  style={{
                    ...styles.photoThumb,
                    backgroundImage: `url(${photo.url})`,
                  }}
                />
                <button
                  style={styles.deletePhotoBtn}
                  onClick={() => handleDeletePhoto(photo.id)}
                >
                  &#10005;
                </button>
              </div>
            ))}
            {(user.photos?.length || 0) < 6 && (
              <div
                style={styles.addPhotoBtn}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <div className="spinner" />
                ) : (
                  <>
                    <span style={{ fontSize: '28px' }}>+</span>
                    <span style={{ fontSize: '12px' }}>Add Photo</span>
                  </>
                )}
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handlePhotoUpload}
            style={{ display: 'none' }}
          />
        </div>

        {/* Basic Info */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Basic Info</h3>

          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              type="text"
              className="form-input"
              value={form.displayName}
              onChange={(e) => updateForm('displayName', e.target.value)}
              maxLength={50}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Bio</label>
            <textarea
              className="form-input"
              placeholder="Tell people about yourself..."
              value={form.bio}
              onChange={(e) => updateForm('bio', e.target.value)}
              maxLength={500}
            />
            <span style={styles.charCount}>{form.bio.length}/500</span>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">City</label>
              <input
                type="text"
                className="form-input"
                placeholder="City"
                value={form.locationCity}
                onChange={(e) => updateForm('locationCity', e.target.value)}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">State</label>
              <input
                type="text"
                className="form-input"
                placeholder="State"
                value={form.locationState}
                onChange={(e) => updateForm('locationState', e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Occupation</label>
            <input
              type="text"
              className="form-input"
              placeholder="What do you do?"
              value={form.occupation}
              onChange={(e) => updateForm('occupation', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Education</label>
            <input
              type="text"
              className="form-input"
              placeholder="Where did you study?"
              value={form.education}
              onChange={(e) => updateForm('education', e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Height (cm)</label>
              <input
                type="number"
                className="form-input"
                placeholder="cm"
                value={form.heightCm}
                onChange={(e) => updateForm('heightCm', e.target.value)}
                min={100}
                max={250}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Looking For</label>
              <select
                className="form-select"
                value={form.lookingFor}
                onChange={(e) => updateForm('lookingFor', e.target.value)}
              >
                <option value="relationship">Relationship</option>
                <option value="casual">Casual</option>
                <option value="friendship">Friendship</option>
                <option value="not-sure">Not Sure</option>
              </select>
            </div>
          </div>
        </div>

        {/* Interests */}
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>
            Interests ({selectedInterests.length}/10)
          </h3>
          {Object.entries(interestsByCategory).map(([category, interests]) => (
            <div key={category} style={{ marginBottom: '16px' }}>
              <p style={styles.categoryLabel}>
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </p>
              <div style={styles.interestsGrid}>
                {interests.map((interest) => (
                  <button
                    key={interest.id}
                    className={`tag ${selectedInterests.includes(interest.id) ? 'tag-highlight' : ''}`}
                    onClick={() => toggleInterest(interest.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    {interest.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Save button */}
        <div style={styles.saveSection}>
          <button
            className="btn btn-primary btn-block btn-lg"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backBtn: {
    background: 'none',
    border: 'none',
    fontSize: '16px',
    fontWeight: '600',
    color: '#e94057',
    cursor: 'pointer',
    padding: '8px',
  },
  content: {
    padding: '0 16px 100px',
  },
  section: {
    marginBottom: '24px',
    paddingBottom: '24px',
    borderBottom: '1px solid #f1f2f6',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '700',
    marginBottom: '16px',
  },
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
  },
  photoItem: {
    position: 'relative',
    aspectRatio: '1',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
    borderRadius: '12px',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  },
  deletePhotoBtn: {
    position: 'absolute',
    top: '-6px',
    right: '-6px',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#ff4757',
    color: 'white',
    border: 'none',
    fontSize: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  addPhotoBtn: {
    aspectRatio: '1',
    borderRadius: '12px',
    border: '2px dashed #dfe6e9',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    color: '#b2bec3',
    cursor: 'pointer',
    transition: 'border-color 0.2s, color 0.2s',
  },
  charCount: {
    display: 'block',
    textAlign: 'right' as const,
    fontSize: '12px',
    color: '#b2bec3',
    marginTop: '4px',
  },
  categoryLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#636e72',
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  interestsGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  saveSection: {
    position: 'fixed',
    bottom: '72px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '100%',
    maxWidth: '448px',
    padding: '16px',
    background: 'linear-gradient(transparent, white 30%)',
  },
};

export default EditProfile;
