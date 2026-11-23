/** No authentication or network implementation is available in this fixture. */
export const authApi = { async logout(): Promise<void> { throw new Error('Component fixture has no authentication backend'); } };
