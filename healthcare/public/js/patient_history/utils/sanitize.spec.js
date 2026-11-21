import { describe, expect, it } from "vitest";

import { sanitize } from "./sanitize";

describe("sanitize", () => {
    it("removes active elements, event handlers and unsafe URLs", () => {
        const output = sanitize(
            '<p onclick="alert(1)">Safe <img src="javascript:alert(2)"></p><script>alert(3)</script><a href="https://example.com">link</a>',
        );
        expect(output).toContain("Safe");
        expect(output).toContain('href="https://example.com"');
        expect(output).not.toMatch(/onclick|javascript:|<script/i);
    });
});