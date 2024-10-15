FROM golang:1@sha256:a7f2fc9834049c1f5df787690026a53738e55fc097cd8a4a93faa3e06c67ee32 AS builder
WORKDIR /usr/src/app
COPY bin/dummy.go .
ENV GOOS=windows
RUN go build -o /dummy.exe -ldflags '-s -w' dummy.go

FROM python:3-alpine@sha256:81362dd1ee15848b118895328e56041149e1521310f238ed5b2cdefe674e6dbf
ARG variant=basic

ADD ${variant}.json /metadata.json
ADD extension-icon.svg /extension-icon.svg
ADD ui /ui/
ADD bin /bin/
COPY --from=builder /dummy.exe /bin/
ADD compose.yaml /compose/
RUN ln -s does/not/exist /compose/dangling-link
RUN ln -s compose.yaml /compose/link

ENTRYPOINT ["/usr/local/bin/python3", "/bin/server.py"]
