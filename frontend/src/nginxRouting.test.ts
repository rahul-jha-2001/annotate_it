import { describe, expect, it } from "vitest";

import nginxConfig from "../nginx.conf?raw";

describe("production Nginx SPA routing", () => {
  it("serves catalog pages through the SPA without shadowing catalog assets", () => {
    const catalogRoute = nginxConfig.match(
      /location ~ \^\/catalog\(\?:\/\[\^\/\]\+\)\?\/\?\$ \{([\s\S]*?)\n    \}/,
    );

    expect(catalogRoute).not.toBeNull();
    expect(catalogRoute![1]).toContain("try_files /index.html =404;");
    expect(nginxConfig).toContain("location / {");
    expect(nginxConfig).toContain("try_files $uri $uri/ /index.html;");
  });
});
