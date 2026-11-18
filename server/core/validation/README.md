# Validation Module

Centralized Zod schema validation middleware.

## Files

| File            | Purpose                    |
| --------------- | -------------------------- |
| `middleware.ts` | Express middleware factory |
| `registry.ts`   | Central schema registry    |
| `index.ts`      | Module exports             |

## Usage

### Single Source Validation

```typescript
import { validate } from "./core/validation";
import { createTransactionSchema } from "./modules/transactions/transactions.validation";

router.post(
  "/transactions",
  validate(createTransactionSchema, "body"),
  transactionController.create
);
```

### Query String Validation

```typescript
router.get(
  "/transactions",
  validate(listQuerySchema, "query"),
  transactionController.list
);
```

### Multiple Sources

```typescript
import { validateMultiple } from "./core/validation";

router.put(
  "/transactions/:id",
  validateMultiple({
    params: idSchema,
    body: updateTransactionSchema,
  }),
  transactionController.update
);
```

## Accessing Validated Data

```typescript
// After validation, access via req.validated
const data = req.validated.body;
const query = req.validated.query;
const params = req.validated.params;
```

## Type-Safe Request

```typescript
import { ValidatedRequest } from "./core/validation";

type CreateRequest = ValidatedRequest<CreateTransactionInput>;

async function create(req: CreateRequest, res: Response) {
  const { amount, category } = req.validated.body!;
}
```

## Error Handling

Validation errors throw `ValidationError` with Zod error details:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "fields": [{ "path": ["amount"], "message": "Required" }]
  }
}
```

## Options

```typescript
validate(schema, "body", {
  stripUnknown: true, // Remove extra fields (default)
  abortEarly: false, // Report all errors (default)
});
```
