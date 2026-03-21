# ERP-system

Nexora by Sigma Fusion is a Next.js and Prisma based ERP-style workspace for content operations.

## Main Areas

- Content Studio for PDF and image question extraction
- Media Studio for creative asset generation workflows
- Whiteboard workspace for PDF review and annotation
- Library, profile, organization, and admin management flows

## Stack

- Next.js 14
- React 18
- TypeScript
- Prisma
- NextAuth

## Local Setup

```bash
npm install
npm run dev
```

## Notes

- Local secrets should live in `.env` and are intentionally not committed.
- Runtime generated files under `public/uploads/` are intentionally not committed.
