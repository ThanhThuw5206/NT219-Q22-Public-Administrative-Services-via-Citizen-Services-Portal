import { describe, expect, it } from "vitest";
import router from "../../src/routes/public.routes.js";

const routeIndex = (method, path) => {
    return router.stack.findIndex((layer) => {
        const route = layer.route;
        return route?.path === path && route.methods?.[method] === true;
    });
};

describe("public route ordering", () => {
    it("keeps public key routes before document verification routes", () => {
        const keyDetailIndex = routeIndex("get", "/keys/:keyId");
        const verifyIndex = routeIndex("get", "/documents/verify/:documentId");

        expect(keyDetailIndex).toBeGreaterThanOrEqual(0);
        expect(verifyIndex).toBeGreaterThanOrEqual(0);
        expect(keyDetailIndex).toBeLessThan(verifyIndex);
    });

    it("does not expose broad public signing key listing", () => {
        expect(routeIndex("get", "/keys")).toBe(-1);
    });
});
