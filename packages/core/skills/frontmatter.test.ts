import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("parses single-line values", () => {
    const { frontmatter, body } = parseFrontmatter(
      "---\nname: foo\ndescription: bar\n---\nbody content",
    );
    expect(frontmatter).toEqual({ name: "foo", description: "bar" });
    expect(body).toBe("body content");
  });

  it("strips double quotes", () => {
    const { frontmatter } = parseFrontmatter(
      '---\nname: "foo"\ndescription: "hello world"\n---\n',
    );
    expect(frontmatter).toEqual({ name: "foo", description: "hello world" });
  });

  it("strips single quotes", () => {
    const { frontmatter } = parseFrontmatter(
      "---\nname: 'foo'\ndescription: 'hello world'\n---\n",
    );
    expect(frontmatter).toEqual({ name: "foo", description: "hello world" });
  });

  it("preserves newlines in literal block scalar", () => {
    const { frontmatter } = parseFrontmatter(
      "---\nname: foo\ndescription: |\n  line1\n  line2\n---\n",
    );
    expect(frontmatter?.description).toBe("line1\nline2\n");
  });

  it("drops trailing newline with strip chomping", () => {
    const { frontmatter } = parseFrontmatter(
      "---\nname: foo\ndescription: |-\n  line1\n  line2\n---\n",
    );
    expect(frontmatter?.description).toBe("line1\nline2");
  });

  it("joins folded block scalar with spaces", () => {
    const { frontmatter } = parseFrontmatter(
      "---\nname: foo\ndescription: >\n  line1\n  line2\n---\n",
    );
    expect(frontmatter?.description).toBe("line1 line2\n");
  });

  it("handles CRLF line endings", () => {
    const { frontmatter } = parseFrontmatter(
      "---\r\nname: foo\r\ndescription: bar\r\n---\r\nbody",
    );
    expect(frontmatter).toEqual({ name: "foo", description: "bar" });
  });

  it("returns null when no frontmatter", () => {
    const result = parseFrontmatter("plain markdown");
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe("plain markdown");
  });

  it("returns null when frontmatter is unterminated", () => {
    const result = parseFrontmatter("---\nname: foo\ndescription: bar\n");
    expect(result.frontmatter).toBeNull();
  });

  it("returns null when YAML is invalid", () => {
    const result = parseFrontmatter("---\n: : : not valid\n---\nbody");
    expect(result.frontmatter).toBeNull();
  });

  it("coerces non-string values to strings", () => {
    const { frontmatter } = parseFrontmatter(
      "---\nname: foo\nversion: 1\nenabled: true\n---\n",
    );
    expect(frontmatter).toEqual({
      name: "foo",
      version: "1",
      enabled: "true",
    });
  });

  // A structured value where a scalar belongs (authoring mistake) must keep the
  // sibling name and JSON-encode the value. This mirrors the Go
  // ParseSkillFrontmatter behaviour in server/internal/skill so both sides agree.
  it("keeps sibling name and JSON-encodes a sequence value", () => {
    const { frontmatter } = parseFrontmatter(
      "---\nname: my-skill\ndescription:\n  - first feature\n  - second feature\n---\nbody",
    );
    expect(frontmatter).toEqual({
      name: "my-skill",
      description: '["first feature","second feature"]',
    });
  });

  it("keeps sibling name and JSON-encodes a mapping value", () => {
    const { frontmatter } = parseFrontmatter(
      "---\nname: my-skill\ndescription:\n  a: 1\n  b: 2\n---\nbody",
    );
    expect(frontmatter).toEqual({
      name: "my-skill",
      description: '{"a":1,"b":2}',
    });
  });
});
