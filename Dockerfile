FROM --platform=$BUILDPLATFORM busybox:1.38 AS filesystem
RUN mkdir /data && chown 65532:65532 /data && chmod 0700 /data

FROM gcr.io/distroless/static-debian12:nonroot
ARG TARGETPLATFORM
COPY $TARGETPLATFORM/tallyo /tallyo
COPY --from=filesystem --chown=65532:65532 /data /data
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["/tallyo"]
