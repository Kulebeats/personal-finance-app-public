# Performance Baseline Report

**Generated:** 2026-01-12
**Server:** localhost:5000
**Environment:** Development

---

## Bundle Analysis

### Before Optimization (Pre-Code Splitting)

| Metric      | Size     |
| ----------- | -------- |
| Main Bundle | 1,393 KB |
| Gzip        | 353 KB   |

### After Optimization (With React.lazy())

| Metric      | Size   | Reduction |
| ----------- | ------ | --------- |
| Main Bundle | 294 KB | **79%**   |
| Gzip        | 84 KB  | **76%**   |

---

## Page Chunk Sizes (Lazy Loaded)

| Page         | Raw Size | Gzip  |
| ------------ | -------- | ----- |
| Reports      | 128 KB   | 31 KB |
| Receipts     | 103 KB   | 25 KB |
| Investments  | 90 KB    | 20 KB |
| Goals        | 66 KB    | 17 KB |
| Dashboard    | 66 KB    | 15 KB |
| Budget       | 61 KB    | 14 KB |
| Transactions | 46 KB    | 13 KB |

---

## Largest Dependencies

| Dependency    | Size   | Gzip   | Notes          |
| ------------- | ------ | ------ | -------------- |
| Recharts      | 783 KB | 228 KB | Chart library  |
| React         | 142 KB | 45 KB  | Core framework |
| Radix UI      | 128 KB | 38 KB  | UI components  |
| Framer Motion | 115 KB | 38 KB  | Animations     |

---

## Performance Targets

| Metric                         | Target | Status        |
| ------------------------------ | ------ | ------------- |
| Initial Bundle                 | <300KB | ✅ 294KB      |
| TTI (Time to Interactive)      | <3s    | ⏳ To measure |
| LCP (Largest Contentful Paint) | <2.5s  | ⏳ To measure |
| CLS (Cumulative Layout Shift)  | <0.1   | ⏳ To measure |
| FID (First Input Delay)        | <100ms | ⏳ To measure |

---

## Recommendations

1. **Charts Lazy Loading**: Consider loading charts only when visible
2. **Preloading**: Add `<link rel="preload">` for critical chunks
3. **Service Worker**: Implement for offline support and caching
4. **Image Optimization**: Use WebP format for images
