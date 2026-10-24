#!/bin/bash

source ./Docker/scripts/env_functions.sh

run_package_script() {
    PATH="$PWD/node_modules/.bin:$PATH" bash -c "$(node -p "require('./package.json').scripts['$1']")"
}

if [ "$DOCKER_ENV" != "true" ]; then
    export_env_vars
fi

if [[ "$DATABASE_PROVIDER" == "postgresql" || "$DATABASE_PROVIDER" == "mysql" || "$DATABASE_PROVIDER" == "psql_bouncer" ]]; then
    export DATABASE_URL
    echo "Deploying migrations for $DATABASE_PROVIDER"
    echo "Database URL: $DATABASE_URL"
    # rm -rf ./prisma/migrations
    # cp -r ./prisma/$DATABASE_PROVIDER-migrations ./prisma/migrations
    run_package_script db:deploy
    if [ $? -ne 0 ]; then
        echo "Migration failed"
        exit 1
    else
        echo "Migration succeeded"
    fi
    run_package_script db:generate
    if [ $? -ne 0 ]; then
        echo "Prisma generate failed"
        exit 1
    else
        echo "Prisma generate succeeded"
    fi
else
    echo "Error: Database provider $DATABASE_PROVIDER invalid."
    exit 1
fi
