import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from '../FormField';

describe('FormField', () => {
  it('renders label correctly', () => {
    render(
      <FormField label="Email" htmlFor="email">
        <input id="email" type="email" />
      </FormField>
    );
    
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('renders required indicator when required', () => {
    render(
      <FormField label="Email" required htmlFor="email">
        <input id="email" type="email" />
      </FormField>
    );
    
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('does not render required indicator when not required', () => {
    render(
      <FormField label="Email" htmlFor="email">
        <input id="email" type="email" />
      </FormField>
    );
    
    expect(screen.queryByText('*')).not.toBeInTheDocument();
  });

  it('renders error message when provided', () => {
    render(
      <FormField label="Email" error="Invalid email" htmlFor="email">
        <input id="email" type="email" />
      </FormField>
    );
    
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders hint when provided and no error', () => {
    render(
      <FormField label="Email" hint="We'll never share your email" htmlFor="email">
        <input id="email" type="email" />
      </FormField>
    );
    
    expect(screen.getByText("We'll never share your email")).toBeInTheDocument();
  });

  it('hides hint when error is present', () => {
    render(
      <FormField 
        label="Email" 
        hint="We'll never share your email" 
        error="Invalid email"
        htmlFor="email"
      >
        <input id="email" type="email" />
      </FormField>
    );
    
    expect(screen.queryByText("We'll never share your email")).not.toBeInTheDocument();
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
  });

  it('renders children correctly', () => {
    render(
      <FormField label="Email" htmlFor="email">
        <input id="email" type="email" data-testid="email-input" />
      </FormField>
    );
    
    expect(screen.getByTestId('email-input')).toBeInTheDocument();
  });

  it('has proper accessibility attributes for error', () => {
    render(
      <FormField label="Email" error="Invalid email" htmlFor="email">
        <input id="email" type="email" />
      </FormField>
    );
    
    const errorElement = screen.getByRole('alert');
    expect(errorElement).toHaveAttribute('aria-live', 'polite');
  });
});
