CC = gcc
CFLAGS = -Wall -Wextra -O2
LIBS = -lmicrohttpd -pthread

TARGET = slashbinslash
SRCS = src/main.c src/file_handler.c src/utils.c
OBJS = $(SRCS:.c=.o)

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LIBS)

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(TARGET) $(OBJS)
