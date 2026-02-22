import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <h1 style={styles.logoText}>Spark</h1>
          <p style={styles.tagline}>Find your spark</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={styles.footer}>
          Don't have an account?{' '}
          <Link to="/register" style={styles.link}>Create one</Link>
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
    padding: '40px 32px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
  },
  logo: {
    textAlign: 'center' as const,
    marginBottom: '32px',
  },
  logoText: {
    fontSize: '42px',
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
};

export default Login;
