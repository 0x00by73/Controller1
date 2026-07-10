.PHONY: vendor clean

vendor:
	docker build -t controller1-backend .
	docker run --rm -v "$(abspath ..):/plugin" controller1-backend

clean:
	rm -rf ../py_modules out
