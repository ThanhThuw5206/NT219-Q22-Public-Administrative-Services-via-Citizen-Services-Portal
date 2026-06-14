import { describe, expect, it } from "vitest";
import router from "../../src/routes/document.routes.js";

const routeIndex = (method, path) => {
    return router.stack.findIndex((layer) => {
        const route = layer.route;
        return route?.path === path && route.methods?.[method] === true;
    });
};

describe("document route ordering", () => {
    it("keeps fixed officer routes before the dynamic document detail route", () => {
        const pendingIndex = routeIndex("get", "/pending");
        const issuedIndex = routeIndex("get", "/issued");
        const previewFileIndex = routeIndex("get", "/previews/:previewId/file");
        const signChallengeIndex = routeIndex("post", "/:documentId/sign-challenge");
        const detailIndex = routeIndex("get", "/:documentId");

        expect(pendingIndex).toBeGreaterThanOrEqual(0);
        expect(issuedIndex).toBeGreaterThanOrEqual(0);
        expect(previewFileIndex).toBeGreaterThanOrEqual(0);
        expect(signChallengeIndex).toBeGreaterThanOrEqual(0);
        expect(detailIndex).toBeGreaterThanOrEqual(0);
        expect(pendingIndex).toBeLessThan(detailIndex);
        expect(issuedIndex).toBeLessThan(detailIndex);
        expect(previewFileIndex).toBeLessThan(detailIndex);
        expect(signChallengeIndex).toBeLessThan(detailIndex);
    });
});
