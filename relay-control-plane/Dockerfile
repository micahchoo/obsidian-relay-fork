FROM alpine:latest AS downloader
ARG PB_VERSION=0.22.20
RUN apk add --no-cache wget unzip
RUN wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
    && unzip pocketbase_${PB_VERSION}_linux_amd64.zip -d /pb \
    && chmod +x /pb/pocketbase

FROM alpine:latest
RUN apk add --no-cache ca-certificates wget jq
COPY --from=downloader /pb/pocketbase /pb/pocketbase
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /pb/pocketbase
WORKDIR /pb
ENV PB_HOOKS_DIR=/pb/pb_hooks
EXPOSE 8090
ENTRYPOINT ["/entrypoint.sh"]
