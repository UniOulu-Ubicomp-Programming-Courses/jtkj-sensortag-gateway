#!/bin/sh

# Defaults
rootkey='../root/*.key'
rootcrt='../root/*.crt'
name='client'
time='3650'
pw=''

help="\nUsage:\n $0\n $0 [options]\n\nCreate SSL certificates for MQTTS clients.\n\nDefaults:\n
Name: $name\n Root CA key: $rootkey\n Root CA certificate: $rootcrt\n Password protect generated
key: no\nDuration before expiration: $time days\n\nOptions:\n -n, --name <name>\tThe root filename for
created files\n\t\t\tFor example, 'client' will create files client.csr,client.key,client.crt\n -k,
--key <file>\tRoot CA private key for signing\n -c, --cert <file>\tRoot CA certificate file.\n -p,
--password\t\tCreate a password protected private key\n -t, --time\t\tDuration of generated
certificate before expiration, in days\n"

TEMP=$(getopt -o 'n:k:c:pt:' --long 'name:,key:,cert:,password,time:,help' -n "$0" -- "$@")

if [ $? -ne 0 ]; then
  echo -e $help >&2
  exit 1
fi

eval set -- "$TEMP"
unset TEMP

while true; do
  case "$1" in
    '-n'|'--name')
      name="$2"
      shift 2
      continue
      ;;
    '-k'|'--key')
      rootkey="$2"
      shift 2
      continue
    ;;
    '-c'|'--cert')
      rootcrt="$2"
      shift 2
      continue
    ;;
    '-p'|'--password')
      pw="dsa3"
      shift
      continue
    ;;
    '-t'|'--time')
      time="$2"
      shift 2
      continue
    ;;
    '--help')
      echo -e $help
      exit 1
    ;;
    '--')
      shift
      break
    ;;
    *)
      echo 'Error!' >&2
      exit 1
    ;;
  esac
done

ex=0
! [ -r $rootcrt ] && echo Missing root certificate \"$rootcrt\"! >&2 && ex=1
! [ -r $rootkey ] && echo Missing root key \"$rootkey\"! >&2 && ex=1
[ -n "${time//[0-9]}" ] && echo "Bad duration string (not a number)" >&2 && ex=1
[ -z $name ] && echo "Name has to be nonempty." >&2 && ex=1
[ $ex -eq 1 ] && echo Please create missing files or fix typos. >&2 && exit 1

openssl genrsa $pw -out $name.key 2048

openssl req -new -key $name.key -out $name.csr

openssl x509 -req -days $time -sha1 -extensions v3_req -CA $rootcrt -CAkey $rootkey -CAcreateserial -in $name.csr -out $name.crt
