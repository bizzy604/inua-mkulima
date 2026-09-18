/** OpenAPI 3 contract for the authenticated Inua Mkulima HTTP API. */
export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Inua Mkulima API",
    version: "1.0.0",
    description:
      "Agro-dealer subsidy checkout API. Money values are integer KES minor units: 100 means KES 1.00. Verification is simulated with the configured demo code.",
  },
  servers: [{ url: "/api", description: "Current application origin" }],
  tags: [
    { name: "Health", description: "Service health" },
    { name: "Authentication", description: "Server-side dealer sessions" },
    { name: "Products", description: "Active product catalog management" },
    { name: "Wallet", description: "Assigned farmer wallet" },
    {
      name: "Transactions",
      description: "Preview, complete, and retrieve purchases",
    },
  ],
  security: [{ cookieAuth: [] }],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        security: [],
        summary: "Check API health",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessHealth" },
              },
            },
          },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Authentication"],
        security: [],
        summary: "Create a dealer session",
        description:
          "Browser mutations must include the configured Origin header.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Session created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessDealerContext" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidInput" },
          "401": { $ref: "#/components/responses/InvalidCredentials" },
          "403": { $ref: "#/components/responses/ForbiddenOrigin" },
          "429": { $ref: "#/components/responses/TooManyAttempts" },
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Authentication"],
        summary: "Restore the current dealer session",
        responses: {
          "200": {
            description: "Current session",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessDealerContext" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthenticated" },
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Authentication"],
        summary: "Destroy the current dealer session",
        responses: {
          "200": {
            description: "Session destroyed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessLogout" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthenticated" },
          "403": { $ref: "#/components/responses/ForbiddenOrigin" },
        },
      },
    },
    "/products": {
      get: {
        tags: ["Products"],
        summary: "List active products",
        responses: {
          "200": {
            description: "Active products",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessProducts" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthenticated" },
        },
      },
      post: {
        tags: ["Products"],
        summary: "Create a product",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProductInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Created product",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessProduct" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidInput" },
          "401": { $ref: "#/components/responses/Unauthenticated" },
          "403": { $ref: "#/components/responses/ForbiddenOrigin" },
        },
      },
    },
    "/products/{id}": {
      parameters: [{ $ref: "#/components/parameters/ProductId" }],
      patch: {
        tags: ["Products"],
        summary: "Update a product",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProductPatch" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated product",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessProduct" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidInput" },
          "404": { $ref: "#/components/responses/ProductNotFound" },
          "401": { $ref: "#/components/responses/Unauthenticated" },
          "403": { $ref: "#/components/responses/ForbiddenOrigin" },
        },
      },
      delete: {
        tags: ["Products"],
        summary: "Deactivate a product",
        responses: {
          "200": {
            description: "Product deactivated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessDeactivated" },
              },
            },
          },
          "404": { $ref: "#/components/responses/ProductNotFound" },
          "401": { $ref: "#/components/responses/Unauthenticated" },
          "403": { $ref: "#/components/responses/ForbiddenOrigin" },
        },
      },
    },
    "/wallet": {
      get: {
        tags: ["Wallet"],
        summary: "Get the assigned wallet",
        responses: {
          "200": {
            description: "Assigned wallet",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessWallet" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthenticated" },
          "404": { $ref: "#/components/responses/WalletNotFound" },
        },
      },
    },
    "/transactions/preview": {
      post: {
        tags: ["Transactions"],
        summary: "Calculate a purchase without writing",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CartRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Canonical preview",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessPreview" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidInput" },
          "401": { $ref: "#/components/responses/Unauthenticated" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/transactions": {
      post: {
        tags: ["Transactions"],
        summary: "Complete or safely replay a purchase",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PaymentRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "New purchase committed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessTransaction" },
              },
            },
          },
          "200": {
            description: "Existing purchase replayed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessTransaction" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidInput" },
          "401": { $ref: "#/components/responses/Unauthenticated" },
          "403": { $ref: "#/components/responses/ForbiddenOrigin" },
          "409": { $ref: "#/components/responses/Conflict" },
          "429": { $ref: "#/components/responses/TooManyAttempts" },
        },
      },
      get: {
        tags: ["Transactions"],
        summary: "List completed purchases",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Offset" },
        ],
        responses: {
          "200": {
            description: "Owned purchase history",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessTransactionList" },
              },
            },
          },
          "400": { $ref: "#/components/responses/InvalidInput" },
          "401": { $ref: "#/components/responses/Unauthenticated" },
        },
      },
    },
    "/transactions/{id}": {
      parameters: [{ $ref: "#/components/parameters/TransactionId" }],
      get: {
        tags: ["Transactions"],
        summary: "Retrieve an owned purchase",
        responses: {
          "200": {
            description: "Saved purchase",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SuccessTransaction" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthenticated" },
          "404": { $ref: "#/components/responses/TransactionNotFound" },
        },
      },
    },
    "/transactions/{id}/receipt": {
      parameters: [{ $ref: "#/components/parameters/TransactionId" }],
      get: {
        tags: ["Transactions"],
        summary: "Download an owned purchase receipt",
        responses: {
          "200": {
            description: "PDF receipt",
            content: {
              "application/pdf": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthenticated" },
          "404": { $ref: "#/components/responses/TransactionNotFound" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: "inua.sid" },
    },
    parameters: {
      ProductId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "integer", minimum: 1 },
      },
      TransactionId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", format: "uuid" },
        description: "Reuse this key for retries of the same economic payload.",
      },
      Limit: {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      Offset: {
        name: "offset",
        in: "query",
        schema: { type: "integer", minimum: 0, default: 0 },
      },
    },
    responses: {
      InvalidInput: {
        description: "Request validation failed",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      InvalidCredentials: {
        description: "Invalid username or password",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      Unauthenticated: {
        description: "A valid dealer session is required",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      ForbiddenOrigin: {
        description: "Mutation Origin is not allowed",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      TooManyAttempts: {
        description: "Rate limit exceeded",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      Conflict: {
        description:
          "Price, product, funds, verification, or idempotency conflict",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      ProductNotFound: {
        description: "Product not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      WalletNotFound: {
        description: "Assigned wallet not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      TransactionNotFound: {
        description: "Transaction not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
    schemas: {
      LoginRequest: {
        type: "object",
        required: ["username", "password"],
        properties: {
          username: { type: "string", example: "demo" },
          password: {
            type: "string",
            format: "password",
            example: "Demo-checkout-123!",
          },
        },
        additionalProperties: false,
      },
      DealerContext: {
        type: "object",
        required: ["dealerId", "username", "walletId"],
        properties: {
          dealerId: { type: "string", example: "demo-dealer" },
          username: { type: "string", example: "demo" },
          walletId: { type: "integer", example: 1 },
        },
      },
      ProductInput: {
        type: "object",
        required: ["name", "priceMinor"],
        properties: {
          name: {
            type: "string",
            minLength: 1,
            maxLength: 200,
            example: "Animal feeds 10kg",
          },
          priceMinor: { type: "integer", minimum: 1, example: 150000 },
        },
        additionalProperties: false,
      },
      ProductPatch: {
        type: "object",
        minProperties: 1,
        properties: {
          name: {
            type: "string",
            minLength: 1,
            maxLength: 200,
            example: "Animal feeds 10kg",
          },
          priceMinor: { type: "integer", minimum: 1, example: 150000 },
        },
        additionalProperties: false,
        description: "Provide one or both fields.",
      },
      Product: {
        allOf: [{ $ref: "#/components/schemas/ProductInput" }],
        required: ["id", "active", "createdAt", "updatedAt"],
        properties: {
          id: { type: "integer", example: 1 },
          active: { type: "boolean", example: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CartItem: {
        type: "object",
        required: [
          "productId",
          "quantity",
          "expectedUnitPriceMinor",
          "deductionMinor",
        ],
        properties: {
          productId: { type: "integer", minimum: 1, example: 1 },
          quantity: { type: "integer", minimum: 1, maximum: 999, example: 1 },
          expectedUnitPriceMinor: {
            type: "integer",
            minimum: 1,
            example: 150000,
          },
          deductionMinor: { type: "integer", minimum: 0, example: 90000 },
        },
        additionalProperties: false,
      },
      CartRequest: {
        type: "object",
        required: ["items", "expectedDeductionTotalMinor"],
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 50,
            uniqueItems: true,
            items: { $ref: "#/components/schemas/CartItem" },
          },
          expectedDeductionTotalMinor: {
            type: "integer",
            minimum: 1,
            example: 140000,
          },
        },
        additionalProperties: false,
      },
      PaymentRequest: {
        allOf: [{ $ref: "#/components/schemas/CartRequest" }],
        required: ["verificationCode"],
        properties: {
          verificationCode: {
            type: "string",
            pattern: "^[0-9]{6}$",
            example: "123456",
          },
        },
      },
      PreviewItem: {
        allOf: [{ $ref: "#/components/schemas/CartItem" }],
        required: ["productName", "unitPriceMinor", "lineTotalMinor"],
        properties: {
          productName: { type: "string" },
          unitPriceMinor: { type: "integer" },
          lineTotalMinor: { type: "integer" },
        },
      },
      Preview: {
        type: "object",
        required: [
          "items",
          "purchaseTotalMinor",
          "deductionTotalMinor",
          "customerDueMinor",
          "walletBalanceMinor",
          "walletAfterMinor",
        ],
        properties: {
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/PreviewItem" },
          },
          purchaseTotalMinor: { type: "integer", example: 210000 },
          deductionTotalMinor: { type: "integer", example: 140000 },
          customerDueMinor: { type: "integer", example: 70000 },
          walletBalanceMinor: { type: "integer", example: 240000 },
          walletAfterMinor: { type: "integer", example: 100000 },
        },
      },
      Wallet: {
        type: "object",
        required: [
          "id",
          "name",
          "currency",
          "balanceMinor",
          "formattedBalance",
        ],
        properties: {
          id: { type: "integer", example: 1 },
          name: { type: "string", example: "Inua Mkulima" },
          currency: { type: "string", example: "KES" },
          balanceMinor: { type: "integer", example: 240000 },
          formattedBalance: { type: "string", example: "KES 2,400.00" },
        },
      },
      Transaction: {
        allOf: [{ $ref: "#/components/schemas/Preview" }],
        required: [
          "id",
          "dealerId",
          "walletId",
          "requestId",
          "walletBeforeMinor",
          "createdAt",
          "receiptParties",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          dealerId: { type: "string" },
          walletId: { type: "integer" },
          requestId: { type: "string" },
          walletBeforeMinor: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          receiptParties: {
            type: "object",
            properties: {
              dealer: { type: "object" },
              farmer: { type: "object" },
              walletName: { type: "string" },
            },
          },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string", example: "INVALID_INPUT" },
              message: { type: "string" },
              requestId: { type: "string", format: "uuid" },
              fields: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
          },
        },
      },
      SuccessHealth: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: { status: { type: "string", example: "ok" } },
          },
        },
      },
      SuccessDealerContext: {
        type: "object",
        properties: { data: { $ref: "#/components/schemas/DealerContext" } },
      },
      SuccessLogout: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: { loggedOut: { type: "boolean", example: true } },
          },
        },
      },
      SuccessProducts: {
        type: "object",
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/Product" },
          },
        },
      },
      SuccessProduct: {
        type: "object",
        properties: { data: { $ref: "#/components/schemas/Product" } },
      },
      SuccessDeactivated: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              id: { type: "integer" },
              active: { type: "boolean", example: false },
            },
          },
        },
      },
      SuccessWallet: {
        type: "object",
        properties: { data: { $ref: "#/components/schemas/Wallet" } },
      },
      SuccessPreview: {
        type: "object",
        properties: { data: { $ref: "#/components/schemas/Preview" } },
      },
      SuccessTransaction: {
        type: "object",
        properties: { data: { $ref: "#/components/schemas/Transaction" } },
      },
      SuccessTransactionList: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: { $ref: "#/components/schemas/Transaction" },
              },
              total: { type: "integer" },
              limit: { type: "integer" },
              offset: { type: "integer" },
            },
          },
        },
      },
    },
  },
} as const;

export const swaggerUiHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inua Mkulima API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.10/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.11.10/swagger-ui-bundle.js"></script>
    <script>window.ui = SwaggerUIBundle({ url: '/api-docs.json', dom_id: '#swagger-ui', deepLinking: true, presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.plugins.DownloadUrl], layout: 'BaseLayout' });</script>
  </body>
</html>`;
