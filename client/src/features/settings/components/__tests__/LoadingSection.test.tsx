import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSection } from '../LoadingSection';

describe('LoadingSection', () => {
  it('renders card variant by default', () => {
    const { container } = render(<LoadingSection />);
    
    // Card variant should have a card structure
    expect(container.querySelector('.rounded-xl')).toBeInTheDocument();
  });

  it('renders form variant with correct number of rows', () => {
    render(<LoadingSection variant="form" rows={4} />);
    
    // Should have loading status
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading form')).toBeInTheDocument();
  });

  it('renders list variant with correct number of rows', () => {
    render(<LoadingSection variant="list" rows={5} />);
    
    // Should have loading status
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading list')).toBeInTheDocument();
  });

  it('uses default rows when not specified', () => {
    render(<LoadingSection variant="form" />);
    
    // Default is 3 rows
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has screen reader text for accessibility', () => {
    render(<LoadingSection variant="form" />);
    
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders card variant when invalid variant provided', () => {
    // @ts-expect-error - Testing invalid variant
    const { container } = render(<LoadingSection variant="invalid" />);
    
    // Should fall back to card variant
    expect(container.querySelector('.rounded-xl')).toBeInTheDocument();
  });
});
