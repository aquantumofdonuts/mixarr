import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionWizard } from '../components/ConnectionWizard';
import type { Connection } from '../components/ConnectionCard';

// ---------------------------------------------------------------------------
// Hoisted mocks – vi.hoisted runs before any vi.mock factory
// ---------------------------------------------------------------------------

const {
  mockSaveConnection,
  mockTestConnection,
  mockDeleteConnection,
  mockUseAuth,
} = vi.hoisted(() => ({
  mockSaveConnection: vi.fn().mockResolvedValue(true),
  mockTestConnection: vi.fn(),
  mockDeleteConnection: vi.fn(),
  mockUseAuth: vi.fn(() => ({
    user: { id: 1, username: 'admin', displayName: 'Admin', role: 'admin' as const },
    isLoading: false,
    isAuthenticated: true,
    setupRequired: false,
    apiError: false,
    login: vi.fn(),
    logout: vi.fn(),
    refetchAuth: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({ useAuth: mockUseAuth }));

vi.mock('../hooks/useConnectionForm', () => ({
  useConnectionForm: () => ({
    saveConnection: mockSaveConnection,
    testConnection: mockTestConnection,
    deleteConnection: mockDeleteConnection,
    testingId: null,
    isSaving: false,
    error: null,
  }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { connection: { config: {} } } }),
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
    put: vi.fn().mockResolvedValue({ data: null, error: null }),
    delete: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

// Mock the form barrel to provide a controllable dummy form for every type.
// The mock form exposes a "Fill Form" button so tests can trigger onConfigReady.
vi.mock('../components/forms', () => {
  const React = require('react'); // eslint-disable-line @typescript-eslint/no-require-imports

  function MockForm(props: {
    onConfigReady: (c: Record<string, unknown>) => void;
    onConfigInvalid: () => void;
  }) {
    return React.createElement(
      'div',
      { 'data-testid': 'mock-form' },
      React.createElement(
        'button',
        {
          'data-testid': 'fill-form',
          onClick: () => props.onConfigReady({ url: 'http://localhost', apiKey: 'test-key' }),
        },
        'Fill Form',
      ),
      React.createElement(
        'button',
        {
          'data-testid': 'clear-form',
          onClick: () => props.onConfigInvalid(),
        },
        'Clear Form',
      ),
    );
  }

  // Return MockForm for every key (any connection type)
  const connectionForms = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'string' && prop !== '__esModule') return MockForm;
        return undefined;
      },
    },
  );

  return { connectionForms };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
};

function makeConnection(overrides?: Partial<Connection>): Connection {
  return {
    id: 42,
    userId: null,
    type: 'lidarr',
    name: 'My Lidarr',
    isActive: true,
    lastTest: null,
    createdAt: '2025-01-01T00:00:00Z',
    user: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectionWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveConnection.mockResolvedValue(true);
  });

  // --- Step 1: type selection ---

  it('create mode starts at step 1 (type selection)', () => {
    render(<ConnectionWizard {...defaultProps} />);

    expect(screen.getByText('Add Connection')).toBeInTheDocument();
    expect(screen.getByText('Choose a connection type to get started')).toBeInTheDocument();
    // All 10 connection type cards should be visible
    expect(screen.getByTestId('type-card-lidarr')).toBeInTheDocument();
    expect(screen.getByTestId('type-card-spotify')).toBeInTheDocument();
    expect(screen.getByTestId('type-card-slskd')).toBeInTheDocument();
  });

  it('clicking a type advances to step 2', () => {
    render(<ConnectionWizard {...defaultProps} />);

    fireEvent.click(screen.getByTestId('type-card-lidarr'));

    // Step 2 should now be visible with form elements
    expect(screen.getByLabelText('Connection Name')).toBeInTheDocument();
    expect(screen.getByTestId('mock-form')).toBeInTheDocument();
  });

  // --- Step 2: configure ---

  it('edit mode starts at step 2 with pre-filled name', async () => {
    const conn = makeConnection({ name: 'Production Lidarr' });
    render(<ConnectionWizard {...defaultProps} editingConnection={conn} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Production Lidarr')).toBeInTheDocument();
    });
    expect(screen.getByTestId('mock-form')).toBeInTheDocument();
  });

  it('back button returns to step 1 from step 2 in create mode', () => {
    render(<ConnectionWizard {...defaultProps} />);

    // Go to step 2
    fireEvent.click(screen.getByTestId('type-card-spotify'));
    expect(screen.getByTestId('mock-form')).toBeInTheDocument();

    // Click Back
    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    // Should be back at step 1
    expect(screen.getByText('Add Connection')).toBeInTheDocument();
    expect(screen.getByTestId('type-card-lidarr')).toBeInTheDocument();
  });

  it('next button disabled until form is valid and name is entered', () => {
    render(<ConnectionWizard {...defaultProps} />);

    fireEvent.click(screen.getByTestId('type-card-lidarr'));

    const nextButton = screen.getByRole('button', { name: /next/i });
    // Name is pre-filled ("My Lidarr") but config is not yet valid
    expect(nextButton).toBeDisabled();

    // Fill the form → makes config valid
    fireEvent.click(screen.getByTestId('fill-form'));
    expect(nextButton).toBeEnabled();
  });

  it('next button disabled when connection name is empty', () => {
    render(<ConnectionWizard {...defaultProps} />);

    fireEvent.click(screen.getByTestId('type-card-lidarr'));

    // Clear the pre-filled name
    const nameInput = screen.getByLabelText('Connection Name');
    fireEvent.change(nameInput, { target: { value: '' } });

    // Fill the form
    fireEvent.click(screen.getByTestId('fill-form'));

    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeDisabled();
  });

  // --- Step 3: save & test ---

  it('step 3 saves and tests the connection (edit mode)', async () => {
    const conn = makeConnection();
    render(<ConnectionWizard {...defaultProps} editingConnection={conn} />);

    // Wait for step 2 to render with pre-filled data
    await waitFor(() => {
      expect(screen.getByTestId('mock-form')).toBeInTheDocument();
    });

    // Fill form and advance
    fireEvent.click(screen.getByTestId('fill-form'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Step 3: should show saving spinner then success
    // userId=null → isGlobal=true in edit mode
    await waitFor(() => {
      expect(mockSaveConnection).toHaveBeenCalledWith(
        'lidarr',
        'My Lidarr',
        { url: 'http://localhost', apiKey: 'test-key' },
        true,
        42,
      );
    });

    // After save succeeds, testConnection should be called with the editing ID
    await waitFor(() => {
      expect(mockTestConnection).toHaveBeenCalledWith(42);
    });

    // Since testingId stays null in the mock, success phase is reached
    await waitFor(() => {
      expect(screen.getByText('Connection saved and tested!')).toBeInTheDocument();
    });
  });

  it('step 3 saves without testing in create mode', async () => {
    render(<ConnectionWizard {...defaultProps} />);

    fireEvent.click(screen.getByTestId('type-card-lidarr'));
    fireEvent.click(screen.getByTestId('fill-form'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(mockSaveConnection).toHaveBeenCalled();
    });

    // No editingId → testConnection should NOT be called
    await waitFor(() => {
      expect(mockTestConnection).not.toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('Connection saved!')).toBeInTheDocument();
    });
  });

  it('shows save failure when saveConnection returns false', async () => {
    mockSaveConnection.mockResolvedValueOnce(false);
    const conn = makeConnection();
    render(<ConnectionWizard {...defaultProps} editingConnection={conn} />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-form')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('fill-form'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('Failed to save connection')).toBeInTheDocument();
    });
  });

  // --- Close ---

  it('onClose called when wizard completes and user clicks Close', async () => {
    render(<ConnectionWizard {...defaultProps} />);

    fireEvent.click(screen.getByTestId('type-card-lidarr'));
    fireEvent.click(screen.getByTestId('fill-form'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('Connection saved!')).toBeInTheDocument();
    });

    // There are two Close buttons: the modal's X (aria-label) and the wizard's Close text button.
    // Target the wizard's text Close button.
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    const wizardCloseBtn = closeButtons.find((btn) => btn.textContent === 'Close')!;
    fireEvent.click(wizardCloseBtn);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  // --- Admin-only global checkbox ---

  it('shows global connection checkbox for admin users', () => {
    render(<ConnectionWizard {...defaultProps} />);

    fireEvent.click(screen.getByTestId('type-card-lidarr'));

    expect(
      screen.getByLabelText(/global connection/i),
    ).toBeInTheDocument();
  });

  it('hides global connection checkbox for non-admin users', () => {
    const nonAdminAuth = {
      user: { id: 2, username: 'user', displayName: 'User', role: 'user' as const },
      isLoading: false,
      isAuthenticated: true,
      setupRequired: false,
      apiError: false,
      login: vi.fn(),
      logout: vi.fn(),
      refetchAuth: vi.fn(),
    };
    mockUseAuth.mockReturnValue(nonAdminAuth);

    render(<ConnectionWizard {...defaultProps} />);

    fireEvent.click(screen.getByTestId('type-card-lidarr'));

    expect(screen.queryByLabelText(/global connection/i)).not.toBeInTheDocument();

    // Restore default admin mock
    mockUseAuth.mockReturnValue({
      user: { id: 1, username: 'admin', displayName: 'Admin', role: 'admin' as const },
      isLoading: false,
      isAuthenticated: true,
      setupRequired: false,
      apiError: false,
      login: vi.fn(),
      logout: vi.fn(),
      refetchAuth: vi.fn(),
    });
  });

  // --- preselectedType ---

  it('skips step 1 when preselectedType is provided', () => {
    render(<ConnectionWizard {...defaultProps} preselectedType="spotify" />);

    // Should jump straight to step 2
    expect(screen.getByDisplayValue('My Spotify')).toBeInTheDocument();
    expect(screen.getByTestId('mock-form')).toBeInTheDocument();
  });

  // --- State reset ---

  it('resets state when closed and reopened', () => {
    const { rerender } = render(<ConnectionWizard {...defaultProps} />);

    // Go to step 2
    fireEvent.click(screen.getByTestId('type-card-lidarr'));
    expect(screen.getByTestId('mock-form')).toBeInTheDocument();

    // Close
    rerender(<ConnectionWizard {...defaultProps} isOpen={false} />);

    // Reopen
    rerender(<ConnectionWizard {...defaultProps} isOpen={true} />);

    // Should be back at step 1
    expect(screen.getByText('Add Connection')).toBeInTheDocument();
    expect(screen.getByTestId('type-card-lidarr')).toBeInTheDocument();
  });
});
