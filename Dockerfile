# Glama builds this to check that the server starts and answers MCP introspection (spec 0137).
# It installs the published release instead of copying this repo, so it builds without a context.
# The node tag floats; the package version is the pin.
FROM node:22-alpine
ARG LINKONDA_MCP_VERSION=0.1.6
RUN npm install -g @veranoapp/linkonda-mcp@${LINKONDA_MCP_VERSION}
USER node
ENTRYPOINT ["linkonda-mcp"]
