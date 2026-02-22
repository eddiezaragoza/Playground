import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    displayName: '',
    age: '',
    gender: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const updateForm = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (parseInt(form.age) < 18) {
      setError('You must be at least 18 years old');
      return;
    }

    if (!form.gender) {
      setError('Please select your gender');
      return;
    }

    setLoading(true);

    try {
      await register({
        email: form.email,
        password: form.password,
        displayName: form.displayName,
        age: parseInt(form.age),
        gender: form.gender,
      });
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <h1 style={styles.logoText}>Spark</h1>
          <p style={styles.tagline}>Create your account</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="How should we call you?"
              value={form.displayName}
              onChange={(e) => updateForm('displayName', e.target.value)}
              required
              minLength={2}
              maxLength={50}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              placeholder="your@email.com"
              value={form.email}
              onChange={(e) => updateForm('email', e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Age</label>
              <input
                type="number"
                className="form-input"
                placeholder="Age"
                value={form.age}
                onChange={(e) => updateForm('age', e.target.value)}
                required
                min={18}
                max={120}
              />
            </div>

            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Gender</label>
              <select
                className="form-select"
                value={form.gender}
                onChange={(e) => updateForm('gender', e.target.value)}
                required
              >
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non-binary">Non-binary</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="At least 8 characters"
              value={form.password}
              onChange={(e) => updateForm('password', e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="Re-enter your password"
              value={form.confirmPassword}
              onChange={(e) => updateForm('confirmPassword', e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p style={styles.footer}>
          Already have an account?{' '}
          <Link to="/login" style={styles.link}>Sign in</Link>
        </p>

        <p style={styles.terms}>
          By creating an account, you agree to our Terms of Service and Privacy Policy.
          You must be at least 18 years old to use Spark.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: 'linear-gradient(135deg, #e94057 0%, #8a2be2 100%)',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    background: 'white',
    borderRadius: '24px',
    padding: '32px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
  },
  logo: {
    textAlign: 'center' as const,
    marginBottom: '24px',
  },
  logoText: {
    fontSize: '36px',
    fontWeight: '800',
    background: 'linear-gradient(135deg, #e94057, #8a2be2)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  tagline: {
    color: '#636e72',
    fontSize: '16px',
    marginTop: '4px',
  },
  footer: {
    textAlign: 'center' as const,
    marginTop: '24px',
    color: '#636e72',
    fontSize: '15px',
  },
  link: {
    color: '#e94057',
    fontWeight: '600',
  },
  terms: {
    textAlign: 'center' as const,
    marginTop: '16px',
    color: '#b2bec3',
    fontSize: '12px',
    lineHeight: '1.4',
  },
};

export default Register;
