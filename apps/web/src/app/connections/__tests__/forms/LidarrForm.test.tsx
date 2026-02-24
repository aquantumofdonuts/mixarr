import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LidarrForm } from '../../components/forms/LidarrForm';

// Mock the API module
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '@/lib/api';

const defaultProps = {
  baseUrl: 'http://localhost:3000',
  onConfigReady: vi.fn(),
  onConfigInvalid: vi.fn(),
};

describe('LidarrForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders URL and API Key fields', () => {
    render(<LidarrForm {...defaultProps} />);
    expect(screen.getByPlaceholderText('http://localhost:8686')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter API key')).toBeInTheDocument();
  });

  it('pre-populates from initialConfig', () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { qualityProfiles: [{ id: 1, name: 'Any' }], rootFolders: [{ id: 1, path: '/music' }] },
      error: null,
      status: 200,
    });

    render(
      <LidarrForm
        {...defaultProps}
        initialConfig={{
          url: 'http://lidarr:8686',
          apiKey: 'abc123',
          qualityProfileId: 1,
          rootFolderPath: '/music',
          monitorOption: 'future',
          monitorNewItems: 'new',
          searchOnAdd: false,
        }}
        connectionId={42}
      />
    );
    expect(screen.getByPlaceholderText('http://localhost:8686')).toHaveValue('http://lidarr:8686');
    expect(screen.getByPlaceholderText('Enter API key')).toHaveValue('abc123');
  });

  it('calls onConfigReady when URL and API Key are provided', () => {
    render(<LidarrForm {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('http://localhost:8686'), {
      target: { value: 'http://lidarr:8686' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter API key'), {
      target: { value: 'mykey' },
    });
    expect(defaultProps.onConfigReady).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://lidarr:8686', apiKey: 'mykey' })
    );
  });

  it('calls onConfigInvalid when required fields are empty', () => {
    render(<LidarrForm {...defaultProps} />);
    // Initial render with empty fields should call onConfigInvalid
    expect(defaultProps.onConfigInvalid).toHaveBeenCalled();
  });

  it('calls onConfigInvalid when API key is cleared', () => {
    render(
      <LidarrForm
        {...defaultProps}
        initialConfig={{ url: 'http://lidarr:8686', apiKey: 'key' }}
      />
    );
    // Clear the onConfigReady calls from initial render
    vi.clearAllMocks();

    fireEvent.change(screen.getByPlaceholderText('Enter API key'), {
      target: { value: '' },
    });
    expect(defaultProps.onConfigInvalid).toHaveBeenCalled();
  });

  it('"Fetch Options" triggers API call and populates dropdowns', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        success: true,
        qualityProfiles: [
          { id: 1, name: 'Lossless' },
          { id: 2, name: 'Standard' },
        ],
        rootFolders: [{ id: 1, path: '/music' }],
      },
      error: null,
      status: 200,
    });

    render(
      <LidarrForm
        {...defaultProps}
        initialConfig={{ url: 'http://lidarr:8686', apiKey: 'key123' }}
      />
    );

    // The "Fetch Lidarr Options" button should be visible
    const fetchButton = screen.getByRole('button', { name: /Fetch Lidarr Options/i });
    expect(fetchButton).toBeInTheDocument();

    fireEvent.click(fetchButton);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/connections/test-lidarr', {
        url: 'http://lidarr:8686',
        apiKey: 'key123',
      });
    });

    // After fetching, dropdowns should appear
    await waitFor(() => {
      expect(screen.getByText('Lidarr Import Settings')).toBeInTheDocument();
    });

    // Quality profile options should be in the dropdown
    expect(screen.getByText('Lossless')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('/music')).toBeInTheDocument();
  });

  it('auto-fetches options when connectionId is provided', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        qualityProfiles: [{ id: 1, name: 'Any' }],
        rootFolders: [{ id: 1, path: '/data/music' }],
      },
      error: null,
      status: 200,
    });

    render(
      <LidarrForm
        {...defaultProps}
        connectionId={5}
        initialConfig={{ url: 'http://lidarr:8686', apiKey: '' }}
      />
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/connections/5/lidarr-options');
    });
  });
});
