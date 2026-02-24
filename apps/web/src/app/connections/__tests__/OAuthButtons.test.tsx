import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuthButtons, type OAuthButtonsProps } from '../components/OAuthButtons';

// ---------------------------------------------------------------------------
// Mock the useOAuthStatus hook
// ---------------------------------------------------------------------------
const mockAuthorize = vi.fn();
const mockRevoke = vi.fn();

vi.mock('../hooks/useOAuthStatus', () => ({
  useOAuthStatus: vi.fn(),
}));

import { useOAuthStatus } from '../hooks/useOAuthStatus';

/** Helper to set the mocked hook return value. */
function mockHook(overrides: Partial<ReturnType<typeof useOAuthStatus>> = {}) {
  vi.mocked(useOAuthStatus).mockReturnValue({
    status: null,
    authorize: mockAuthorize,
    revoke: mockRevoke,
    isLoading: false,
    error: null,
    ...overrides,
  });
}

const defaultProps: OAuthButtonsProps = {
  type: 'spotify',
  connectionId: 1,
};

describe('OAuthButtons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Unauthorized state -------------------------------------------------

  it('shows Authorize button when status is null (not yet loaded)', () => {
    mockHook({ status: null });
    render(<OAuthButtons {...defaultProps} />);

    expect(screen.getByRole('button', { name: /authorize spotify/i })).toBeInTheDocument();
  });

  it('shows Authorize button when status is not authorized', () => {
    mockHook({
      status: { authorized: false, expired: false, needsReauthorization: false },
    });
    render(<OAuthButtons {...defaultProps} />);

    expect(screen.getByRole('button', { name: /authorize spotify/i })).toBeInTheDocument();
    expect(screen.queryByText('Revoke')).not.toBeInTheDocument();
  });

  it('shows Re-authorize button when token is expired', () => {
    mockHook({
      status: { authorized: false, expired: true, needsReauthorization: true },
    });
    render(<OAuthButtons {...defaultProps} />);

    expect(screen.getByRole('button', { name: /re-authorize spotify/i })).toBeInTheDocument();
  });

  it('shows Authorize button when needsReauthorization even if authorized', () => {
    mockHook({
      status: { authorized: true, expired: false, needsReauthorization: true },
    });
    render(<OAuthButtons {...defaultProps} />);

    expect(screen.getByRole('button', { name: /authorize spotify/i })).toBeInTheDocument();
  });

  // --- Authorized state ---------------------------------------------------

  it('shows Authorized badge and Revoke button when authorized', () => {
    mockHook({
      status: { authorized: true, expired: false, needsReauthorization: false },
    });
    render(<OAuthButtons {...defaultProps} />);

    expect(screen.getByText('Authorized')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /authorize/i })).not.toBeInTheDocument();
  });

  // --- Preview button (Spotify only) --------------------------------------

  it('shows Preview button for Spotify when authorized and onPreview provided', () => {
    mockHook({
      status: { authorized: true, expired: false, needsReauthorization: false },
    });
    const onPreview = vi.fn();
    render(<OAuthButtons {...defaultProps} type="spotify" onPreview={onPreview} />);

    expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument();
  });

  it('does NOT show Preview button for Deezer even when authorized', () => {
    mockHook({
      status: { authorized: true, expired: false, needsReauthorization: false },
    });
    const onPreview = vi.fn();
    render(<OAuthButtons {...defaultProps} type="deezer" onPreview={onPreview} />);

    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument();
  });

  it('does NOT show Preview button for TIDAL even when authorized', () => {
    mockHook({
      status: { authorized: true, expired: false, needsReauthorization: false },
    });
    const onPreview = vi.fn();
    render(<OAuthButtons {...defaultProps} type="tidal" onPreview={onPreview} />);

    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument();
  });

  it('does NOT show Preview for Spotify when onPreview is not provided', () => {
    mockHook({
      status: { authorized: true, expired: false, needsReauthorization: false },
    });
    render(<OAuthButtons {...defaultProps} type="spotify" />);

    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument();
  });

  // --- Callbacks ----------------------------------------------------------

  it('calls authorize on Authorize button click', () => {
    mockHook({
      status: { authorized: false, expired: false, needsReauthorization: false },
    });
    render(<OAuthButtons {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /authorize spotify/i }));
    expect(mockAuthorize).toHaveBeenCalledTimes(1);
  });

  it('calls revoke on Revoke button click', () => {
    mockHook({
      status: { authorized: true, expired: false, needsReauthorization: false },
    });
    render(<OAuthButtons {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /revoke/i }));
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });

  it('calls onPreview with connectionId and type when Preview clicked', () => {
    mockHook({
      status: { authorized: true, expired: false, needsReauthorization: false },
    });
    const onPreview = vi.fn();
    render(<OAuthButtons {...defaultProps} connectionId={42} onPreview={onPreview} />);

    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    expect(onPreview).toHaveBeenCalledWith(42, 'spotify');
  });

  // --- Loading state ------------------------------------------------------

  it('shows loading state on Authorize button when isLoading is true', () => {
    mockHook({
      status: { authorized: false, expired: false, needsReauthorization: false },
      isLoading: true,
    });
    render(<OAuthButtons {...defaultProps} />);

    const btn = screen.getByRole('button', { name: /authorize spotify/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('shows loading state on Revoke button when isLoading is true', () => {
    mockHook({
      status: { authorized: true, expired: false, needsReauthorization: false },
      isLoading: true,
    });
    render(<OAuthButtons {...defaultProps} />);

    const btn = screen.getByRole('button', { name: /revoke/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  // --- Error state --------------------------------------------------------

  it('displays error message when error is present', () => {
    mockHook({
      status: { authorized: false, expired: false, needsReauthorization: false },
      error: new Error('Token exchange failed'),
    });
    render(<OAuthButtons {...defaultProps} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Token exchange failed');
  });

  it('does not display error alert when error is null', () => {
    mockHook({
      status: { authorized: true, expired: false, needsReauthorization: false },
      error: null,
    });
    render(<OAuthButtons {...defaultProps} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // --- Correct hook invocation --------------------------------------------

  it('passes type and connectionId to useOAuthStatus', () => {
    mockHook();
    render(<OAuthButtons type="tidal" connectionId={99} />);

    expect(useOAuthStatus).toHaveBeenCalledWith('tidal', 99);
  });

  // --- Service label rendering --------------------------------------------

  it('renders correct label for Deezer', () => {
    mockHook({
      status: { authorized: false, expired: false, needsReauthorization: false },
    });
    render(<OAuthButtons {...defaultProps} type="deezer" />);

    expect(screen.getByRole('button', { name: /authorize deezer/i })).toBeInTheDocument();
  });

  it('renders correct label for TIDAL', () => {
    mockHook({
      status: { authorized: false, expired: false, needsReauthorization: false },
    });
    render(<OAuthButtons {...defaultProps} type="tidal" />);

    expect(screen.getByRole('button', { name: /authorize tidal/i })).toBeInTheDocument();
  });
});
