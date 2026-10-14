const forbidden = "script, style, iframe, object, embed, link, meta, base";
export function sanitize(markup) {
    const parsed = new DOMParser().parseFromString(String(markup || ""), "text/html");
    parsed.body.querySelectorAll(forbidden).forEach(node => node.remove());
    parsed.body.querySelectorAll("*").forEach(node => {
        for (const attribute of[...node.attributes]) {
            const value = attribute.value.trim().toLowerCase();
            if (
                /^on/i.test(attribute.name) ||
                (["href", "src", "xlink:href"].includes(attribute.name.toLowerCase()) &&
                    /^(javascript|vbscript|data:text\/html):/.test(value))
            )
                node.removeAttribute(attribute.name);
        }
    });
    parsed.body.querySelectorAll("svg").forEach(node => {
        if (!node.hasAttribute("width")) node.setAttribute("width", "16");
        if (!node.hasAttribute("height")) node.setAttribute("height", "16");
        node.setAttribute("aria-hidden", "true");
    });
    parsed.body.querySelectorAll("table").forEach(table => {
        const wrapper = parsed.createElement("div");
        wrapper.className = "ph-document-table-scroll";
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
    });
    return parsed.body.innerHTML;
}