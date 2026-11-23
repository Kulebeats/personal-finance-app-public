import { describe, it, expect } from 'vitest';
import { transformApiToFormData, transformFormToApiData } from '../useProfileForm';
import { profileSchema } from '@/features/settings/schemas/profileSchema';
import { updateProfileSchema } from '../../../../../../../server/modules/settings/settings.profile.validation';

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

/**
 * PUT /api/settings/profile refuses unknown keys (400). The body must carry
 * exactly the keys the server accepts, and never picture or banner, which the
 * server saves only through their upload endpoints.
 */
describe('transformFormToApiData request body', () => {
  // Independently listed: server/modules/settings/settings.profile.validation.ts
  const serverAcceptedKeys = [
    'fullName', 'firstName', 'lastName', 'displayName', 'birthday', 'birthdayHideYear',
    'timezone', 'bio', 'gender', 'phoneNumberMobile', 'phoneNumberWork', 'phoneNumberHome',
    'occupation', 'address', 'annualIncome', 'incomeFrequency', 'employmentStatus',
    'investmentGoal', 'riskTolerance', 'nrc', 'socialLinks',
  ];

  it('sends only server-accepted keys, with legacy address and social keys dropped', () => {
    const form = transformApiToFormData({
      fullName: 'Jane Banda',
      nrc: '123456/78/9',
      profilePictureUrl: '/uploads/profiles/jane.png',
      bannerUrl: '/uploads/banners/jane.png',
      phoneNumberMobile: '+260971234567',
      annualIncome: '150000.50',
      address: { street: '12 Cairo Road', city: 'Lusaka', country: 'ZM' },
      socialLinks: { website: 'https://example.test', instagram: 'legacy' } as never,
    });

    const body = transformFormToApiData(form);

    expect(Object.keys(body).every(key => serverAcceptedKeys.includes(key))).toBe(true);
    for (const refused of ['salaryRange', 'profilePicture', 'profilePictureUrl', 'bannerUrl']) {
      expect(body).not.toHaveProperty(refused);
    }
    expect(body.nrc).toBe('123456/78/9');
    expect(Object.keys(body.address ?? {}).sort()).toEqual(
      ['addressLine1', 'addressLine2', 'city', 'country', 'postalCode', 'state'],
    );
    expect(body.address?.addressLine1).toBe('12 Cairo Road');
    expect(Object.keys(body.socialLinks ?? {})).not.toContain('instagram');
    expect(body.phoneNumberMobile).toBe('+260971234567');
    expect(body.annualIncome).toBe('150000.50');
  });

  it('sends an empty NRC so the server clears it', () => {
    const body = transformFormToApiData(transformApiToFormData({ fullName: 'Jane Banda', nrc: null }));
    expect(body.nrc).toBe('');
  });
});

/**
 * R05.1 contract: the profile form, the body it sends and the server's Zod
 * schema name the same fields. A field added to one side only fails here.
 */
describe('profile form and server schema contract (R05.1)', () => {
  // Saved by their own upload endpoints, never by PUT /api/settings/profile.
  const uploadOnlyFormFields = ['bannerUrl', 'profilePicture'];
  const serverKeys = Object.keys(updateProfileSchema.shape).sort();

  it('every form field is a server field or an upload-only field, and the reverse', () => {
    const formKeys = Object.keys(profileSchema.shape).sort();
    expect(formKeys.filter(key => !uploadOnlyFormFields.includes(key))).toEqual(serverKeys);
  });

  it('the request body built from a full form carries exactly the server fields', () => {
    const body = transformFormToApiData(transformApiToFormData({ fullName: 'Jane Banda' }));
    expect(Object.keys(body).sort()).toEqual(serverKeys);
  });
});
