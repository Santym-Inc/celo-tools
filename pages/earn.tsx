import { GroupVote } from '@celo/contractkit/lib/wrappers/Election';
import { PendingWithdrawal } from '@celo/contractkit/lib/wrappers/LockedGold';
import { ValidatorGroup } from '@celo/contractkit/lib/wrappers/Validators';
import { BigNumber } from 'bignumber.js';
import {
  CopyText,
  CustomSelectSearch,
  LockCelo,
  Panel,
  Table,
  toast,
} from 'components';
import { useCallback, useEffect, useState, Validator } from 'react';
import Loader from 'react-loader-spinner';
import { useContractKit } from '@celo-tools/use-contractkit';
import { formatAmount, toWei, truncate, truncateAddress } from 'utils';
import Web3 from 'web3';
import { Base } from 'state';
import { ContractKit } from '@celo/contractkit';

enum States {
  None,
  Activating,
  Revoking,
  Locking,
  Unlocking,
  Voting,
}

export async function getValidatorGroupScore(
  kit: ContractKit,
  groupAddress: string,
  electedValidators: any[]
) {
  const validators = await kit.contracts.getValidators();
  const group = await validators.getValidatorGroup(groupAddress, false);

  let totalScore = new BigNumber(0);
  let electedCount = 0;
  group.members.forEach((address) => {
    const v = electedValidators.find((ev) => ev.address === address);
    if (v) {
      totalScore = totalScore.plus(v.score);
      electedCount++;
    }
  });

  const score =
    electedCount === 0 || totalScore.eq(0)
      ? new BigNumber(0)
      : totalScore.dividedBy(electedCount);
  return { score, electedCount };
}

export default function Earn() {
  const { kit, send, address } = useContractKit();
  const { lockedSummary, fetchLockedSummary, balances } = Base.useContainer();

  const [groupVotes, setGroupVotes] = useState<GroupVote[]>([]);
  const [hasActivatablePendingVotes, setHasActivatablePendingVotes] = useState(
    false
  );
  const [state, setState] = useState(States.None);

  const [groups, setGroups] = useState<
    (ValidatorGroup & {
      score: BigNumber;
      totalVotes: BigNumber;
      electedCount: number;
    })[]
  >([]);
  const [voteAmount, setVoteAmount] = useState('');
  const [votingAddress, setVotingAddress] = useState('');

  const [totalVotes, setTotalVotes] = useState(new BigNumber(0));
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  const [sort, setSort] = useState({ property: 'score', desc: true });

  const sortFn = useCallback(
    (a, b) => {
      const propA = a[sort.property];
      const propB = b[sort.property];

      if (sort.desc) {
        return propB - propA;
      }
      return propA - propB;
    },
    [sort]
  );

  const activate = useCallback(async () => {
    setState(States.Activating);
    try {
      const election = await kit.contracts.getElection();
      await send(await election.activate(address));
      toast.success('Votes activated');
    } catch (e) {
      toast.error(`Unable to activate votes ${e.message}`);
    }
    fetchVotingSummary();
    setState(States.None);
  }, [kit, send, fetchLockedSummary, address]);

  const vote = useCallback(
    async (address: string, value: string) => {
      setState(States.Voting);
      try {
        const election = await kit.contracts.getElection();
        await send(
          await election.vote(address, new BigNumber(Web3.utils.toWei(value)))
        );
        toast.success('Vote cast');

        setVoteAmount('');
        setVotingAddress('');
      } catch (e) {
        toast.error(`Unable to vote ${e.message}`);
      } finally {
        setState(States.None);
        fetchVotingSummary();
      }
    },
    [kit, send, fetchLockedSummary]
  );

  const revoke = useCallback(
    async (address: string, value: string) => {
      setState(States.Revoking);
      try {
        const election = await kit.contracts.getElection();
        await send(
          await election.revoke(
            kit.defaultAccount,
            address,
            new BigNumber(value)
          )
        );
        toast.success('Vote cast');
      } catch (e) {
        toast.error(`Unable to vote ${e.message}`);
      } finally {
        setState(States.None);
        fetchVotingSummary();
      }
    },
    [kit, send, fetchLockedSummary]
  );

  const fetchVotingSummary = useCallback(async () => {
    if (!address) {
      return;
    }

    const election = await kit.contracts.getElection();
    const votedForGroups = await election.getGroupsVotedForByAccount(address);

    setGroupVotes(
      await Promise.all(
        votedForGroups.map((groupAddress) =>
          election.getVotesForGroupByAccount(address, groupAddress)
        )
      )
    );

    setHasActivatablePendingVotes(
      await election.hasActivatablePendingVotes(address)
    );
  }, [kit, address]);

  const fetchValidators = useCallback(async () => {
    setLoading(true);

    const election = await kit.contracts.getElection();
    const validators = await kit.contracts.getValidators();

    setTotalVotes(await election.getTotalVotes());

    const registeredGroups = await validators.getRegisteredValidatorGroups();
    const electedValidatorSigners = await election.getCurrentValidatorSigners();

    const electedValidators = await Promise.all(
      electedValidatorSigners.map(async (signer) => {
        const account = await validators.signerToAccount(signer);
        return validators.getValidator(account);
      })
    );

    const groupsWithScore = await Promise.all(
      registeredGroups.map(async (g) => {
        const totalVotes = await election.getTotalVotesForGroup(g.address);
        const { score, electedCount } = await getValidatorGroupScore(
          // @ts-ignore
          kit,
          g.address,
          electedValidators
        );

        return {
          ...g,
          score,
          electedCount,
          totalVotes,
        };
      })
    );

    setGroups(groupsWithScore);
    setLoading(false);
  }, [kit]);

  useEffect(() => {
    fetchVotingSummary();
  }, [fetchVotingSummary]);

  useEffect(() => {
    fetchValidators();
  }, [fetchValidators]);

  const voting = lockedSummary.lockedGold.total.minus(
    lockedSummary.lockedGold.nonvoting
  );
  const total = lockedSummary.lockedGold.total.plus(balances.celo);
  const nonLocked = balances.celo;

  const votingPct = voting.dividedBy(total).times(100);
  const nonvotingPct = lockedSummary.lockedGold.nonvoting
    .dividedBy(lockedSummary.lockedGold.total)
    .times(100);
  const notLockedPct = nonLocked.dividedBy(total).times(100);

  const votingPctStr = votingPct.isNaN() ? '0' : votingPct.toFixed(0);
  const nonvotingPctStr = nonvotingPct.isNaN() ? '0' : nonvotingPct.toFixed(0);
  const notLockedPctStr = notLockedPct.isNaN() ? '0' : notLockedPct.toFixed(0);

  return (
    <>
      <Panel>
        <div>
          <div className="text-gray-200 text-xl font-medium">
            Earn with CELO
          </div>
          <p className="text-gray-400 text-xs md:text-sm mt-2">
            Staking your CELO is a great way to earn passive rewards. To begin
            staking you first need to lock your CELO, then you're free to vote
            for validator groups of your choosing.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row space-y-1 md:space-y-0 md:space-x-3 items-end justify-end">
            <span
              style={{ width: 'fit-content' }}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 whitespace-no-wrap"
            >
              <svg
                className="-ml-0.5 mr-1.5 h-2 w-2 text-green-400"
                fill="currentColor"
                viewBox="0 0 8 8"
              >
                <circle cx={4} cy={4} r={3} />
              </svg>
              Voting ({votingPctStr}%)
            </span>

            <span
              style={{ width: 'fit-content' }}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 whitespace-no-wrap"
            >
              <svg
                className="-ml-0.5 mr-1.5 h-2 w-2 text-gray-400"
                fill="currentColor"
                viewBox="0 0 8 8"
              >
                <circle cx={4} cy={4} r={3} />
              </svg>
              Locked ({nonvotingPctStr}%)
            </span>

            <span
              style={{ width: 'fit-content' }}
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-400 text-gray-900 whitespace-no-wrap"
            >
              <svg
                className="-ml-0.5 mr-1.5 h-2 w-2 text-gray-900"
                fill="currentColor"
                viewBox="0 0 8 8"
              >
                <circle cx={4} cy={4} r={3} />
              </svg>
              Not Locked ({notLockedPctStr}%)
            </span>
          </div>
          <div className="bg-gray-600 w-full flex rounded h-2">
            <div
              id="voting"
              className="bg-green-700 rounded-l"
              style={{ width: `${votingPctStr}%` }}
            ></div>
            <div
              id="locked"
              className="bg-gray-400"
              style={{ width: `${nonvotingPctStr}%` }}
            ></div>
          </div>
        </div>
      </Panel>

      <LockCelo />

      <Panel>
        <div className="md:grid md:grid-cols-4 md:gap-6 py-2">
          <div className="md:col-span-1">
            <h3 className="text-lg font-medium leading-6 text-gray-200">
              Vote
            </h3>
          </div>
          <div className="mt-2 md:mt-0 md:col-span-3">
            <div className="space-y-6">
              <div className="text-gray-400 text-sm">
                {truncateAddress(address || '0x')} currently has{' '}
                <span className="font-medium text-gray-200">
                  {formatAmount(lockedSummary.lockedGold.nonvoting, 2)}
                </span>{' '}
                ({nonvotingPctStr}%) CELO locked and ready to vote with.
              </div>

              <div className="text-gray-400 text-sm">
                After voting for any group there is a{' '}
                <span className="text-gray-200">24</span> hour waiting period
                you must observe before activating your votes. Please ensure you
                check back here to activate any votes and start earning rewards.
              </div>

              {hasActivatablePendingVotes && (
                <div className="flex">
                  <button onClick={activate} className="ml-auto primary-button">
                    Activate Pending
                  </button>
                </div>
              )}

              <div>
                <ul className="list-decimal list-inside">
                  {groupVotes.map((gv) => {
                    const group = groups.find((g) => g.address === gv.group);
                    if (!group) {
                      return null;
                    }
                    return (
                      <li className="flex flex-col mb-3">
                        <div className="line-clamp-1">
                          <span className="text-gray-300 text-sm">
                            {truncate(group.name, 30)}
                          </span>
                          <span className="text-gray-400 text-sm flex space-x-2 mt-1">
                            <span>({truncateAddress(group.address)})</span>
                            <CopyText text={group.address} />
                          </span>
                        </div>

                        <div className="relative flex flex-col mt-2">
                          <span className="inline-flex items-center rounded-md text-xs font-medium text-gray-600">
                            {formatAmount(gv.active, 2)} ACTIVE (
                            {gv.active
                              .dividedBy(lockedSummary.lockedGold.total)
                              .times(100)
                              .toFixed(0)}
                            )%
                          </span>
                          <span className="inline-flex items-center rounded-md text-xs font-medium text-blue-600 mt-1">
                            {formatAmount(gv.pending, 2)} PENDING (
                            {gv.pending
                              .dividedBy(lockedSummary.lockedGold.total)
                              .times(100)
                              .toFixed(0)}
                            )%
                          </span>
                          <div className="absolute right-0 top-0">
                            {gv.active && (
                              <>
                                {state === States.Revoking ? (
                                  <Loader
                                    type="TailSpin"
                                    color="white"
                                    height={'12px'}
                                    width="12px"
                                  />
                                ) : (
                                  <button
                                    className="text-gray-300 text-sm hover:text-gray-400"
                                    onClick={() =>
                                      revoke(gv.group, gv.active.toString())
                                    }
                                  >
                                    Revoke
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {adding ? (
                  <div className="mt-4">
                    <div className="flex flex-col md:flex-row md:space-x-4 items-center">
                      <CustomSelectSearch
                        options={groups.map((vg) => ({
                          ...vg,
                          value: vg.address,
                          name: `${truncate(vg.name, 10)} (${truncateAddress(
                            vg.address
                          )})`,
                        }))}
                        placeholder="Choose a validator group"
                        value={votingAddress}
                        onChange={(a) => setVotingAddress(a)}
                      />

                      <div className="relative rounded-md shadow-sm mt-4 md:mt-0 w-full">
                        <input
                          type="text"
                          name="price"
                          id="price"
                          value={voteAmount}
                          onChange={(e) => setVoteAmount(e.target.value)}
                          // className="focus:ring-gray-500 focus:border-gray-500 block w-full pr-12 sm:text-sm border-gray-300 rounded-md"
                          className="appearance-none block pl-3 pr-16 py-2 border border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm bg-gray-600 text-gray-300 w-full"
                          placeholder={'0'}
                        />
                        <div className="absolute inset-y-0 right-0 flex items-center">
                          <div className="flex items-center justify-center focus:ring-gray-500 focus:border-gray-500 h-full py-0 pl-2 pr-4 border-transparent bg-transparent text-gray-300 sm:text-sm rounded-md">
                            CELO
                          </div>
                        </div>
                      </div>

                      {state === States.Voting ? (
                        <span className="px-6 py-2">
                          <Loader type="TailSpin" height={20} width={20} />
                        </span>
                      ) : (
                        <button
                          className="secondary-button"
                          onClick={async () => vote(votingAddress, voteAmount)}
                        >
                          Vote
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-right text-gray-400 mt-2">
                      Staking{' '}
                      <span className="text-gray-200">
                        {toWei(voteAmount)} CELO (Wei)
                      </span>{' '}
                      with{' '}
                      <span className="text-gray-200">
                        {truncate(
                          groups.find((vg) => vg.address === votingAddress)
                            ?.name || '',
                          10
                        )}{' '}
                        {truncateAddress(votingAddress)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAdding(true)}
                    className="rounded-md px-4 py-1 text-gray-300 text-sm font-medium bg-gray-700 hover:bg-gray-750"
                  >
                    New vote
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <div>
          <h3 className="text-lg font-medium leading-6 text-gray-200">
            Elected validator groups
          </h3>
          <p className="text-gray-400 mt-2 text-sm">
            Take a look at the below validator groups before voting to have a
            more informed choice. More information around what you should be
            looking for in a validator group can be found in the{' '}
            <a
              className="text-blue-500"
              target="_blank"
              href="https://docs.celo.org/celo-owner-guide/voting-validators"
            >
              Voting for Validator Groups
            </a>{' '}
            guide.
          </p>
        </div>

        <div className="-mx-5">
          <Table
            headers={[
              { displayName: 'Name', sortableProperty: 'name' },
              { displayName: 'Total votes', sortableProperty: 'totalVotes' },
              { displayName: 'Score', sortableProperty: 'score' },
              'Elected',
            ]}
            onHeaderClick={(property, desc) => {
              setSort({ property, desc });
            }}
            sort={sort}
            loading={loading}
            noDataMessage="No validator groups found"
            rows={groups.sort(sortFn).map((g) => [
              <div>
                {!g.name ? (
                  <span className="italic">{truncateAddress(g.address)}</span>
                ) : (
                  truncate(g.name, 20)
                )}
              </div>,
              <div className="text=gray-300">
                {Web3.utils.fromWei(g.totalVotes.toFixed(0)).split('.')[0]} (
                {g.totalVotes.dividedBy(totalVotes).times(100).toFixed(0)}%)
              </div>,
              <div>{g.score.times(100).toFixed(2)}%</div>,
              <div>
                {g.electedCount} / {g.members.length}
              </div>,
            ])}
          />
        </div>
      </Panel>
    </>
  );
}
