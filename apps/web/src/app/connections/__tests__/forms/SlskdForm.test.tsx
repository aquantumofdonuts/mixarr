import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlskdForm } from '../../components/forms/SlskdForm';

const defaultProps = {
  baseUrl: 'http://localhost:3000',
  onConfigReady: vi.fn(),
  onConfigInvalid: vi.fn(),
};

describe('SlskdForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all slskd fields', () => {
    render(<SlskdForm {...defaultProps} />);
    expect(screen.getByPlaceholderText('http://localhost:5030')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('slskd API key')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('/downloads')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('/music')).toBeInTheDocument();
  });

  it('pre-populates from initialConfig', () => {
    render(
      <SlskdForm
        {...defaultProps}
        initialConfig={{
          url: 'http://slskd:5030',
          apiKey: 'myapikey',
          downloadDir: '/data/downloads',
          musicLibraryDir: '/data/music',
        }}
      />
    );
    expect(screen.getByPlaceholderText('http://localhost:5030')).toHaveValue('http://slskd:5030');
    expect(screen.getByPlaceholderText('slskd API key')).toHaveValue('myapikey');
    expect(screen.getByPlaceholderText('/downloads')).toHaveValue('/data/downloads');
    expect(screen.getByPlaceholderText('/music')).toHaveValue('/data/music');
  });

  it('calls onConfigReady when URL and API Key are valid', () => {
    render(<SlskdForm {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('http://localhost:5030'), {
      target: { value: 'http://slskd:5030' },
    });
    fireEvent.change(screen.getByPlaceholderText('slskd API key'), {
      target: { value: 'key123' },
    });
    expect(defaultProps.onConfigReady).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://slskd:5030',
        apiKey: 'key123',
        downloadDir: '/downloads',
        musicLibraryDir: '/music',
      })
    );
  });

  it('calls onConfigInvalid when required fields are empty', () => {
    render(<SlskdForm {...defaultProps} />);
    expect(defaultProps.onConfigInvalid).toHaveBeenCalled();
  });

  it('uses custom directories when provided', () => {
    render(<SlskdForm {...defaultProps} />);
    fireEvent.change(screen.getByPlaceholderText('http://localhost:5030'), {
      target: { value: 'http://slskd:5030' },
    });
    fireEvent.change(screen.getByPlaceholderText('slskd API key'), {
      target: { value: 'key' },
    });
    fireEvent.change(screen.getByPlaceholderText('/downloads'), {
      target: { value: '/custom/dl' },
    });
    fireEvent.change(screen.getByPlaceholderText('/music'), {
      target: { value: '/custom/music' },
    });
    expect(defaultProps.onConfigReady).toHaveBeenLastCalledWith(
      expect.objectContaining({
        downloadDir: '/custom/dl',
        musicLibraryDir: '/custom/music',
      })
    );
  });

  it('renders slskd Documentation link', () => {
    render(<SlskdForm {...defaultProps} />);
    const link = screen.getByRole('link', { name: /slskd Documentation/i });
    expect(link).toHaveAttribute('href', 'https://github.com/slskd/slskd');
  });
});
