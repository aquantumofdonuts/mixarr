import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectionCard, type Connection, type ConnectionCardProps } from '../components/ConnectionCard';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const makeTypeConfig = (overrides?: Partial<ConnectionCardProps['typeConfig']>) => ({
  value: 'spotify',
  label: 'Spotify',
  color: '#1DB954',
  description: 'Import & playlist subscriptions',
  ...overrides,
});

const makeConnection = (overrides?: Partial<Connection>): Connection => ({
  id: 1,
  userId: null,
  type: 'spotify',
  name: 'My Spotify',
  isActive: true,
  lastTest: null,
  createdAt: '2025-01-01T00:00:00Z',
  user: null,
  ...overrides,
});

const defaultProps: ConnectionCardProps = {
  typeConfig: makeTypeConfig(),
  connections: [],
  isAdmin: false,
  onAdd: vi.fn(),
  onEdit: vi.fn(),
  onTest: vi.fn(),
  onDelete: vi.fn(),
  testingId: null,
};

describe('ConnectionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Rendering basics ---

  it('renders type label and description', () => {
    render(<ConnectionCard {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByText('Spotify')).toBeInTheDocument();
    expect(screen.getByText('Import & playlist subscriptions')).toBeInTheDocument();
  });

  it('renders color swatch with first letter of label', () => {
    const { container } = render(<ConnectionCard {...defaultProps} />, { wrapper: Wrapper });
    const swatch = container.querySelector('[style*="background-color"]');
    expect(swatch).toHaveStyle({ backgroundColor: '#1DB954' });
    expect(swatch).toHaveTextContent('S');
  });

  it('renders custom icon when provided', () => {
    const { container } = render(
      <ConnectionCard
        {...defaultProps}
        typeConfig={makeTypeConfig({ icon: '🎵' })}
      />,
      { wrapper: Wrapper },
    );
    const swatch = container.querySelector('[style*="background-color"]');
    expect(swatch).toHaveTextContent('🎵');
  });

  // --- Empty state ---

  it('shows "Configure" button when no connections', () => {
    render(<ConnectionCard {...defaultProps} connections={[]} />, { wrapper: Wrapper });
    expect(screen.getByText('Configure')).toBeInTheDocument();
  });

  it('calls onAdd with type value when Configure is clicked', () => {
    const onAdd = vi.fn();
    render(<ConnectionCard {...defaultProps} onAdd={onAdd} connections={[]} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Configure'));
    expect(onAdd).toHaveBeenCalledWith('spotify');
  });

  it('does not show Configure button when connections exist', () => {
    render(
      <ConnectionCard
        {...defaultProps}
        connections={[makeConnection()]}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByText('Configure')).not.toBeInTheDocument();
  });

  // --- Connection entries ---

  it('renders connection name and active status for each connection', () => {
    const connections = [
      makeConnection({ id: 1, name: 'Primary', isActive: true }),
      makeConnection({ id: 2, name: 'Secondary', isActive: false }),
    ];
    render(<ConnectionCard {...defaultProps} connections={connections} />, { wrapper: Wrapper });

    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Secondary')).toBeInTheDocument();
  });

  // --- Action callbacks ---

  it('calls onTest with correct ID when Test button clicked', () => {
    const onTest = vi.fn();
    const conn = makeConnection({ id: 42 });
    render(<ConnectionCard {...defaultProps} onTest={onTest} connections={[conn]} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTitle('Test connection'));
    expect(onTest).toHaveBeenCalledWith(42);
  });

  it('calls onEdit with correct ID when Edit button clicked', () => {
    const onEdit = vi.fn();
    const conn = makeConnection({ id: 7 });
    render(<ConnectionCard {...defaultProps} onEdit={onEdit} connections={[conn]} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTitle('Edit'));
    expect(onEdit).toHaveBeenCalledWith(7);
  });

  it('calls onDelete with correct ID when Delete button clicked', () => {
    const onDelete = vi.fn();
    const conn = makeConnection({ id: 99 });
    render(<ConnectionCard {...defaultProps} onDelete={onDelete} connections={[conn]} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTitle('Delete'));
    expect(onDelete).toHaveBeenCalledWith(99);
  });

  // --- Testing state ---

  it('disables Test button for the connection being tested', () => {
    const conn = makeConnection({ id: 5 });
    render(
      <ConnectionCard
        {...defaultProps}
        connections={[conn]}
        testingId={5}
      />,
      { wrapper: Wrapper },
    );

    const testBtn = screen.getByTitle('Test connection');
    expect(testBtn).toBeDisabled();
  });

  it('shows animate-pulse class on icon when testingId matches', () => {
    const conn = makeConnection({ id: 5 });
    const { container } = render(
      <ConnectionCard
        {...defaultProps}
        connections={[conn]}
        testingId={5}
      />,
      { wrapper: Wrapper },
    );

    const pulsingIcon = container.querySelector('.animate-pulse');
    expect(pulsingIcon).toBeInTheDocument();
  });

  it('does not disable Test button for other connections', () => {
    const connections = [
      makeConnection({ id: 5 }),
      makeConnection({ id: 10, name: 'Other' }),
    ];
    render(
      <ConnectionCard
        {...defaultProps}
        connections={connections}
        testingId={5}
      />,
      { wrapper: Wrapper },
    );

    const testButtons = screen.getAllByTitle('Test connection');
    // First button (id=5) should be disabled
    expect(testButtons[0]).toBeDisabled();
    // Second button (id=10) should be enabled
    expect(testButtons[1]).not.toBeDisabled();
  });

  // --- Owner badges ---

  it('shows Global badge when isAdmin and userId is null', () => {
    const conn = makeConnection({ userId: null });
    render(
      <ConnectionCard
        {...defaultProps}
        isAdmin={true}
        connections={[conn]}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText('Global')).toBeInTheDocument();
  });

  it('shows Personal badge when isAdmin and userId is set', () => {
    const conn = makeConnection({ userId: 42 });
    render(
      <ConnectionCard
        {...defaultProps}
        isAdmin={true}
        connections={[conn]}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText('Personal')).toBeInTheDocument();
  });

  it('does not show owner badges when not admin', () => {
    const connections = [
      makeConnection({ id: 1, userId: null }),
      makeConnection({ id: 2, userId: 42, name: 'Personal Conn' }),
    ];
    render(
      <ConnectionCard
        {...defaultProps}
        isAdmin={false}
        connections={connections}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.queryByText('Global')).not.toBeInTheDocument();
    expect(screen.queryByText('Personal')).not.toBeInTheDocument();
  });

  // --- Multiple connections ---

  it('renders all connections in the list', () => {
    const connections = [
      makeConnection({ id: 1, name: 'Alpha' }),
      makeConnection({ id: 2, name: 'Bravo' }),
      makeConnection({ id: 3, name: 'Charlie' }),
    ];
    render(<ConnectionCard {...defaultProps} connections={connections} />, { wrapper: Wrapper });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });
});
