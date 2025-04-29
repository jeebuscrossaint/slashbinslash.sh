# slashbinslash.sh

![License](https://img.shields.io/github/license/jeebuscrossaint/debt)
![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS%20%7C%20Windows-green)

> temporary file sharing and storage inspired by temp.sh and termbin.com

## What is slashbinslash.sh

`slashbinslash.sh` or `/bin/sh` is a project that allows users to self host a file sharing service. It provides access via a web interface and a netcat server.

To host /bin/sh simply:

```bash
git clone https://github.com/jeebuscrossaint/slashbinslash.sh.git
cd slashbinslash.sh
npm i # or bun i
npm start # or bun start
```

The webui is quite self explanatory.
![webui is green and black terminal type themed](https://raw.githubusercontent.com/jeebuscrossaint/slashbinslash.sh/main/webui.png)

You can use the netcat server the same way it is used on termbin.com.

```bash
$ echo "/bin/sh" | nc localhost 9999
http://localhost:3000/test
$ curl http://localhost:3000/test
/bin/sh
```

Sending file output is also possible.

```bash
$ cat ~/foo.txt | nc localhost 9999
```

Basically it takes stdin.

```bash
$ ls -la | nc localhost 9999
```

Obviously to use the netcat server the client needs to have the netcat utility installed. It is on all platforms, written by GNU and OpenBSD.
