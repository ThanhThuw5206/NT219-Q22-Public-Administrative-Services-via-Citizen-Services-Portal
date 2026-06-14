import { describe, expect, it } from "vitest";
import router from "../../src/routes/crypto.routes.js";

const routeIndex = (method, path) => {
    return router.stack.findIndex((layer) => {
        const route = layer.route;
        return route?.path === path && route.methods?.[method] === true;
    });
};

describe("crypto route surface", () => {
    it("exposes protected external public-key registration", () => {
        expect(routeIndex("post", "/keys/external-public")).toBeGreaterThanOrEqual(0);
        expect(routeIndex("get", "/public-key")).toBeGreaterThanOrEqual(0);
        expect(routeIndex("post", "/sign")).toBeGreaterThanOrEqual(0);
        expect(routeIndex("post", "/verify")).toBeGreaterThanOrEqual(0);
    });
});
