import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsCard } from '../SettingsCard';

describe('SettingsCard', () => {
  it('renders title correctly', () => {
    render(
      <SettingsCard title="Test Title">
        <div>Content</div>
      </SettingsCard>
    );
    
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <SettingsCard title="Title" description="Test description">
        <div>Content</div>
      </SettingsCard>
    );
    
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('renders children content', () => {
    render(
      <SettingsCard title="Title">
        <div data-testid="child-content">Child Content</div>
      </SettingsCard>
    );
    
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('renders action element when provided', () => {
    render(
      <SettingsCard title="Title" action={<button>Save</button>}>
        <div>Content</div>
      </SettingsCard>
    );
    
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('shows skeleton when loading', () => {
    render(
      <SettingsCard title="Title" isLoading>
        <div data-testid="child-content">Content</div>
      </SettingsCard>
    );
    
    // Title should not be visible when loading
    expect(screen.queryByText('Title')).not.toBeInTheDocument();
    // Child content should not be visible when loading
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });

  it('hides action when loading', () => {
    render(
      <SettingsCard title="Title" action={<button>Save</button>} isLoading>
        <div>Content</div>
      </SettingsCard>
    );
    
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
