- when disconnecting wallet, there should be a confirmation
-

# Now

- somehow when bot added to group, make dummies for all its users (if group admin decides to do so)
- we need to somehow differenciate if settlement recepient has a connected wallet, and what to do if not?
  - prompt him to do so?

- when settiling:
  - we need to clearly and directly explain what is going on.
    - why and where money is going.
    - how should the transaction confirmation screen look?
    - why address is different
    - that he'll be prompted to manually confirm action in his wallet
  - what should user do if not prompted?
  - what do WE do if user should get prompt, but did not?
  - need to clearly process both happy and negative scenarios
    - user declined
    - timed out
    - not enough money
    - not enough gas
    - what else?
    - TON-api (wallet API) timeouts - we need to be sure we have correct confirmation mechanism with retries & backoff and such
    - maybe preliminalry check that APIs we use work?
    - preliminary check that user has enough gas + USDT?
- add TON contract + oracle
- add contracts for other jettons
