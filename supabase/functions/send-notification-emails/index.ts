// Select a verified sender and recipient before enabling DB email delivery.
// The function supports Microsoft Graph or a dedicated Gmail Apps Script.
import { handleWorkerRequest } from "./worker.mjs";

declare const Deno: {
  env: { toObject(): Record<string, string> };
  serve(handler: (request: Request) => Promise<Response>): void;
};

Deno.serve((request: Request) =>
  handleWorkerRequest(request, Deno.env.toObject()));
