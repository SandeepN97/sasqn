# ADR 0001: One TypeScript package

Status: accepted for v0.1.

Choose TypeScript compiled to Node.js ESM, npm bin distribution, built-in subprocess/filesystem APIs and Node's test runner. Zod validates external data; TypeScript alone does not validate JSON.

Python offers similar orchestration ergonomics but adds environment packaging friction. Go simplifies end-user runtime installation but requires platform builds. TypeScript fits the initial developer audience and typed adapter contracts. No monorepo or provider SDK is needed.
