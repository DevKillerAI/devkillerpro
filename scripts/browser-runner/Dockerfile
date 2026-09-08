FROM mcr.microsoft.com/playwright:v1.62.0-noble
WORKDIR /runner
RUN npm install --ignore-scripts --no-audit --no-fund --save-exact playwright@1.62.0
COPY run.cjs /runner/run.cjs
USER pwuser
ENTRYPOINT ["node", "/runner/run.cjs"]
