FROM devkiller-browser:1.62.0
USER root
WORKDIR /opt/generator-v2
# Only reviewed platform dependencies. Never run npm against model-provided files.
RUN npm install --ignore-scripts --no-audit --no-fund --save-exact react@19.2.8 react-dom@19.2.8 esbuild@0.28.2 lucide-react@0.468.0 @supabase/supabase-js@2.112.4
COPY compile.cjs /opt/generator-v2/compile.cjs
COPY workbench.cjs /opt/generator-v2/workbench.cjs
COPY workbench-database.cjs /opt/generator-v2/workbench-database.cjs
USER pwuser
ENV NODE_ENV=production
ENTRYPOINT ["node", "/opt/generator-v2/workbench.cjs"]
