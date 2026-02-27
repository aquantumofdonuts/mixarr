import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeedGrid } from './FeedGrid';

// Mock Next.js Image component
vi.mock('next/image', () => ({
  default: ({ src, alt, fill, ...props }: { src: string; alt: string; fill?: boolean; [key: string]: unknown }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} data-fill={fill ? 'true' : undefined} {...props} />;
  },
}));

// Mock Next.js Link component
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  },
}));

// Mock Next.js navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock IntersectionObserver (jsdom doesn't support it)
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();

let capturedCallback: IntersectionObserverCallback | null = null;

class MockIntersectionObserver {
  observe = mockObserve;
  unobserve = mockUnobserve;
  disconnect = mockDisconnect;
  constructor(callback: IntersectionObserverCallback) {
    capturedCallback = callback;
  }
}

describe('FeedGrid', () => {
  const mockItems = [
    {
      id: 'feed-1',
      artistName: 'Artist 1',
      artistMbid: 'mbid-1',
      imageUrl: null,
      score: 100,
      subscriptionCount: 2,
      sourceCount: 1,
      sources: ['spotify'],
      createdAt: '2026-01-01T00:00:00Z',
      tags: ['rock', 'alternative'],
      listeners: 5000000,
      subscriptionName: 'New Releases',
    },
    {
      id: 'feed-2',
      artistName: 'Artist 2',
      artistMbid: 'mbid-2',
      imageUrl: null,
      score: 80,
      subscriptionCount: 1,
      sourceCount: 1,
      sources: ['lastfm'],
      createdAt: '2026-01-01T00:00:00Z',
      tags: null,
      listeners: null,
      subscriptionName: null,
    },
  ];

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    capturedCallback = null;
  });

  it('renders cards for each item', () => {
    render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={false}
      />
    );

    expect(screen.getByText('Artist 1')).toBeInTheDocument();
    expect(screen.getByText('Artist 2')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    render(
      <FeedGrid
        items={[]}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={false}
      />
    );

    expect(screen.getByText(/No recommendations yet/)).toBeInTheDocument();
    expect(screen.getByText(/Set up subscriptions/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set Up Subscriptions/i })).toBeInTheDocument();
  });

  it('shows loading spinner when loading', () => {
    render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={true}
        isLoading
      />
    );

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('renders in responsive grid layout', () => {
    render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={false}
      />
    );

    const grid = screen.getByTestId('feed-grid');
    expect(grid).toHaveClass('grid-cols-2');
    expect(grid).toHaveClass('md:grid-cols-3');
    expect(grid).toHaveClass('lg:grid-cols-4');
  });

  it('sets up IntersectionObserver when hasMore is true', () => {
    render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={true}
      />
    );

    expect(mockObserve).toHaveBeenCalled();
  });

  it('does not set up IntersectionObserver when hasMore is false', () => {
    render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={false}
      />
    );

    expect(mockObserve).not.toHaveBeenCalled();
  });

  it('cleans up IntersectionObserver on unmount', () => {
    const { unmount } = render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={true}
      />
    );

    unmount();

    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('calls onLoadMore when intersection observed', () => {
    const onLoadMore = vi.fn();

    render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={onLoadMore}
        hasMore={true}
      />
    );

    // Simulate intersection using captured callback
    expect(capturedCallback).not.toBeNull();
    capturedCallback!(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );

    expect(onLoadMore).toHaveBeenCalled();
  });

  it('does not show loading spinner when not loading', () => {
    render(
      <FeedGrid
        items={mockItems}
        onApprove={vi.fn()}
        onDismiss={vi.fn()}
        onLoadMore={vi.fn()}
        hasMore={true}
        isLoading={false}
      />
    );

    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
  });
});
