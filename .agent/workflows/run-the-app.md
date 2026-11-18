---
description: How to run the application (dev server)
---

# Running the Application

// turbo

1. Run the fresh start command which clears port 5000 and starts the dev server:

   ```bash
   npm run start:fresh
   ```

2. Open the browser at http://localhost:5000/login

## Alternative Commands

- `npm run dev` - Start without clearing the port (may fail if port is in use)
- `npm run kill:port` - Just kill any process on port 5000
