import { describe, it, expect } from 'vitest';
import { transformApiToFormData } from '../useProfileForm';

describe('transformApiToFormData', () => {
  it('preserves special characters in fullName', () => {
    const apiData = {
      fullName: '!',
      timezone: 'Africa/Lusaka',
      incomeFrequency: 'monthly',
      birthdayHideYear: false,
    };

    const result = transformApiToFormData(apiData);

    expect(result.fullName).toBe('!');
  });

  it('preserves quote character in fullName', () => {
    const apiData = {
      fullName: '"',
      timezone: 'Africa/Lusaka',
      incomeFrequency: 'monthly',
      birthdayHideYear: false,
    };

    const result = transformApiToFormData(apiData);

    expect(result.fullName).toBe('"');
  });
});

/**
 * Legacy field handling. These fields are NOT on the canonical UserProfile but
 * the API can still return them for older records, so transformApiToFormData
 * reads them defensively. RawProfileApiResponse models them as optional; these
 * tests guard that the mapping (and therefore the type) keeps doing so.
 */
describe('transformApiToFormData legacy fields', () => {
  it('maps legacy address.street -> addressLine1 and address.zip -> postalCode', () => {
    const result = transformApiToFormData({
      fullName: 'Jane',
      address: {
        street: '12 Cairo Road',
        zip: '10101',
        city: 'Lusaka',
        country: 'Zambia',
      },
    });

    expect(result.address.addressLine1).toBe('12 Cairo Road');
    expect(result.address.postalCode).toBe('10101');
    expect(result.address.city).toBe('Lusaka');
    expect(result.address.country).toBe('ZM');
  });

  it('prefers the new addressLine1/postalCode over the legacy street/zip', () => {
    const result = transformApiToFormData({
      fullName: 'Jane',
      address: {
        addressLine1: 'New Line 1',
        street: 'Legacy Street',
        postalCode: '99999',
        zip: '00000',
        country: 'ZM',
      },
    });

    expect(result.address.addressLine1).toBe('New Line 1');
    expect(result.address.postalCode).toBe('99999');
  });

  it('preserves the legacy salaryRange field', () => {
    const result = transformApiToFormData({
      fullName: 'Jane',
      salaryRange: 'ZMW 10,000 - 20,000',
    });

    expect(result.salaryRange).toBe('ZMW 10,000 - 20,000');
  });

  it('falls back to legacy profilePicture when profilePictureUrl is absent', () => {
    const result = transformApiToFormData({
      fullName: 'Jane',
      profilePicture: 'http://example.com/legacy.png',
    });

    expect(result.profilePicture).toBe('http://example.com/legacy.png');
  });

  it('prefers profilePictureUrl over the legacy profilePicture', () => {
    const result = transformApiToFormData({
      fullName: 'Jane',
      profilePictureUrl: 'http://example.com/new.png',
      profilePicture: 'http://example.com/legacy.png',
    });

    expect(result.profilePicture).toBe('http://example.com/new.png');
  });
});
