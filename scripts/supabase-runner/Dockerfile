FROM node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
WORKDIR /opt/runtime
# Only platform-selected dependencies. Never install a generated package manifest.
RUN npm install --ignore-scripts --no-audit --no-fund --save-exact next@15.5.24 react@19.2.8 react-dom@19.2.8 @supabase/ssr@0.12.5 @supabase/supabase-js@2.112.4 typescript@5.9.3 @types/react@19.2.18 @types/react-dom@19.2.5 @types/node@22.20.1 server-only@0.0.1
COPY run.mjs /opt/runtime/run.mjs
USER node
ENV NEXT_TELEMETRY_DISABLED=1
ENTRYPOINT ["node", "/opt/runtime/run.mjs"]
