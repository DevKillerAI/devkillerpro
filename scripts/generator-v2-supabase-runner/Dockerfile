FROM devkiller-browser:1.62.0
USER root
WORKDIR /opt/generator-v2-supabase
# Trusted, pinned platform dependencies only. No candidate package scripts are run.
RUN npm install --ignore-scripts --no-audit --no-fund --save-exact react@19.2.8 react-dom@19.2.8 esbuild@0.28.2 @supabase/supabase-js@2.112.4
COPY run.cjs /opt/generator-v2-supabase/run.cjs
USER pwuser
ENV NODE_ENV=production
ENTRYPOINT ["node", "/opt/generator-v2-supabase/run.cjs"]
