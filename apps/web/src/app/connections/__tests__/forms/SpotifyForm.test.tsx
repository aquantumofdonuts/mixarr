import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpotifyForm } from '../../components/forms/SpotifyForm';

const defaultProps = {
  baseUrl: 'http://localhost:3000',
  onConfigReady: vi.fn(),
  onConfigInvalid: vi.fn(),
};

describe('SpotifyForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Client ID and Client Secret fields', () => {
    render(<SpotifyForm {...defaultProps} />);
    expect(screen.getByPlaceholderText('Spotify client ID')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Spotify client secret')).toBeInTheDocument();
  });

  it('pre-populates from initialConfig', () => {
    render(
      <SpotifyForm
        {...defaultProps}
        initialConfig={{ clientId: 'my-id', clientSecret: 'my-secret' }}
      />
    );
    expect(screen.getByPlaceholderText('Spotify client ID')).toHaveValue('my-id');
    expect(screen.getByPlaceholderText('Spotify client secret')).toHaveValue('my-secret');
  });

  it('calls onConfigReady when both fields are provided', () => {
    render(<SpotifyForm {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('Spotify client ID'), {
      target: { value: 'test-id' },
    });
    fireEvent.change(screen.getByPlaceholderText('Spotify client secret'), {
      target: { value: 'test-secret' },
    });
    expect(defaultProps.onConfigReady).toHaveBeenCalledWith({
      clientId: 'test-id',
      clientSecret: 'test-secret',
    });
  });

  it('calls onConfigInvalid when fields are empty', () => {
    render(<SpotifyForm {...defaultProps} />);
    expect(defaultProps.onConfigInvalid).toHaveBeenCalled();
  });

  it('shows redirect URI with placeholder when no connectionId', () => {
    render(<SpotifyForm {...defaultProps} />);
    expect(
      screen.getByText(
        'http://localhost:3000/api/connections/[ID]/spotify/callback'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Save this connection first/)
    ).toBeInTheDocument();
  });

  it('shows exact redirect URI when connectionId is provided', () => {
    render(<SpotifyForm {...defaultProps} connectionId={42} />);
    expect(
      screen.getByText(
        'http://localhost:3000/api/connections/42/spotify/callback'
      )
    ).toBeInTheDocument();
    // Should NOT show the "save first" hint
    expect(screen.queryByText(/Save this connection first/)).not.toBeInTheDocument();
  });

  it('renders Spotify Developer Dashboard link', () => {
    render(<SpotifyForm {...defaultProps} />);
    const link = screen.getByRole('link', { name: /Spotify Developer Dashboard/i });
    expect(link).toHaveAttribute('href', 'https://developer.spotify.com/dashboard');
  });
});
