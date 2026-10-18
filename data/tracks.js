// Learning paths for learn.html. Hand-written for a newer birder in the Northeast; edit freely.
// `path` is the general "first six months, in order". `tracks` are the five specialty tracks.
// Each step: title, text (one or two plain sentences), species (names from data/traits.js that the step uses;
// shown as chips with their hints). Order matters: each step assumes the one before it.
globalThis.DAYBIRD_TRACKS = {
  path: {
    id: 'path', title: 'Your first six months, in order',
    why: 'Most people start birding three or four times before it sticks, because every outing feels like starting over. This is one sequence instead: each step is a place and a small win, and each one makes the next easier. Take a week or a month per step. Nothing here needs a scope, a trip or a 5 AM alarm until the very end.',
    steps: [
      { title: 'Feeder: name five birds without looking anything up', text: 'Hang a feeder, or sit by one. The same five or six birds come every day, which is the point. Learn them until you stop needing the app.', species: ['Black-capped Chickadee', 'Tufted Titmouse', 'White-breasted Nuthatch', 'Downy Woodpecker', 'Blue Jay', 'Northern Cardinal', 'Dark-eyed Junco', 'Mourning Dove'] },
      { title: 'Yard: ten minutes of listening before coffee', text: 'Stand outside before the day gets loud. Count the different voices, then find the birds making them. Robins, crows and a cardinal will carry you.', species: ['American Robin', 'American Crow', 'Northern Cardinal', 'Song Sparrow', 'House Finch', 'American Goldfinch'] },
      { title: 'Edge: walk the line where trees meet open ground', text: 'A field edge, a rail trail, the back of a parking lot. Edges hold more birds than woods or fields alone. Walk slowly and stop every fifty steps.', species: ['Eastern Bluebird', 'Gray Catbird', 'Cedar Waxwing', 'Yellow-rumped Warbler', 'White-throated Sparrow', 'Northern Flicker', 'Eastern Phoebe'] },
      { title: 'Water: sit at one pond for twenty minutes', text: 'Ducks and herons sit still and let you look. Pick one spot with a view and stay put; the count grows while you wait.', species: ['Mallard', 'Canada Goose', 'Great Blue Heron', 'Wood Duck', 'Hooded Merganser', 'Belted Kingfisher', 'Common Merganser'] },
      { title: 'Woods walk: follow the chickadees', text: 'In the woods, find the chickadee flock and stay with it. Nuthatches, kinglets and a woodpecker or two travel along. Listen for drumming.', species: ['Black-capped Chickadee', 'Golden-crowned Kinglet', 'Red-breasted Nuthatch', 'Hairy Woodpecker', 'Pileated Woodpecker', 'Hermit Thrush', 'Winter Wren'] },
      { title: 'Dawn chorus: be outside forty minutes before sunrise once', text: 'Late spring, one morning. The Brief tells you the first-song time. Stand still and let the whole thing start around you; you do not need to name everything.', species: ['American Robin', 'Wood Thrush', 'Veery', 'Red-eyed Vireo', 'Ovenbird', 'Common Yellowthroat', 'Eastern Towhee'] },
      { title: 'Fall migration morning: a GO day after a north wind', text: 'September or October, the morning after a clear night with a north wind. Work a sunlit edge at first light. Dull warblers and kinglets everywhere; count kinds, not names.', species: ['Yellow-rumped Warbler', 'Palm Warbler', 'Ruby-crowned Kinglet', 'Blue-headed Vireo', 'White-crowned Sparrow', 'Broad-winged Hawk', 'Northern Harrier'] },
      { title: 'First notable bird: chase one report', text: 'Pick one bird from the Brief\'s "Notable nearby" list that other people are seeing, go to that spot, and find it. Then report it on eBird. You are a birder now.', species: ['Evening Grosbeak', 'Rusty Blackbird', 'Snow Bunting', 'Sandhill Crane', 'Peregrine Falcon'] },
    ],
  },
  tracks: [
    { id: 'gulls', title: 'Gulls', group: 'gulls',
      why: 'Gulls are the birds everyone sees and nobody looks at. There are only two common ones here most of the year, and learning to tell them apart, and to tell a young bird from an adult, is the fastest way to start seeing detail. Parking lots count.',
      steps: [
        { title: 'Ring-billed vs. Herring: size and bill', text: 'Ring-billed is the parking-lot gull, smaller, with a black ring on a yellow bill. Herring is bigger, pink-legged, with a red spot on the bill.', species: ['Ring-billed Gull', 'Herring Gull'] },
        { title: 'Brown means young', text: 'A mottled brown gull is a first-year bird, not a different kind. Watch one flock and sort adults from youngsters.', species: ['Herring Gull', 'Ring-billed Gull'] },
        { title: 'Leg color at rest', text: 'Yellow legs on Ring-billed, pink on Herring. Find a resting flock on a ball field and check every bird.', species: ['Ring-billed Gull', 'Herring Gull'] },
        { title: 'Wingtips in flight', text: 'Watch the black at the wingtip as they fly over: how much, and whether there are white spots in it.', species: ['Ring-billed Gull', 'Herring Gull'] },
        { title: 'Scan a lake in late fall', text: 'November and December, big lakes and rivers. Scan every gull in a raft for one that is darker, paler or bigger than the rest.', species: ['Herring Gull', 'Ring-billed Gull', 'Double-crested Cormorant'] },
        { title: 'Age a flock and eBird it', text: 'Count one flock by kind and by age (adult or young) and submit it. Precision over quantity.', species: ['Ring-billed Gull', 'Herring Gull'] },
      ] },
    { id: 'waterfowl', title: 'Waterfowl', group: 'waterfowl',
      why: 'Ducks are the best beginner group there is: they sit on open water in good light and let you look for as long as you want. November is the month, when the northern birds come through and the local ponds fill up.',
      steps: [
        { title: 'Mallard vs. American Black Duck', text: 'The pair you will see most. Black Duck is a dark brown duck with a plain face; a female Mallard is paler with an orange-and-black bill. Check the wing patch: white borders on Mallard, none on Black Duck.', species: ['Mallard', 'American Black Duck'] },
        { title: 'Dabblers vs. divers', text: 'Dabblers tip up and sit high; divers disappear and sit low. Sort one pond into the two kinds before you name anything.', species: ['Mallard', 'Wood Duck', 'Ring-necked Duck', 'Hooded Merganser'] },
        { title: 'Hooded vs. Common Merganser', text: 'Both are sleek fish-eaters. Hooded is small with a fan crest; Common is long, big, with a thin red bill and a green head on the male.', species: ['Hooded Merganser', 'Common Merganser'] },
        { title: 'Scope a lake in November', text: 'Find a lake with a view and give it twenty minutes. Binoculars are fine; borrow a scope if you can. Loons and grebes sit far out.', species: ['Common Loon', 'Pied-billed Grebe', 'Ring-necked Duck', 'Common Merganser'] },
        { title: 'Count a raft', text: 'Pick one group of ducks and count it properly: by tens, then by kind. Counting is what turns looking into data.', species: ['Canada Goose', 'Mallard', 'Ring-necked Duck'] },
        { title: 'eBird your first ten-species duck morning', text: 'One pond or lake, one morning, ten kinds of waterfowl on a checklist. It is very doable in November.', species: ['Mallard', 'American Black Duck', 'Wood Duck', 'Hooded Merganser', 'Common Merganser', 'Ring-necked Duck', 'Canada Goose', 'Common Loon', 'Pied-billed Grebe'] },
      ] },
    { id: 'warblers', title: 'Warblers', group: 'warblers',
      why: 'Warblers are the reason people get up at 5 in May: small, bright, busy, and here for a few weeks. They are hard, so this track starts with the three that are not, and leaves the dull fall birds for last.',
      steps: [
        { title: 'Yellow-rumped: the one that is always here', text: 'First in spring, last in fall, and sometimes around all winter. Learn the yellow rump patch and the "check" call; it is your reference bird.', species: ['Yellow-rumped Warbler'] },
        { title: 'Three songs: Yellowthroat, Ovenbird, Black-throated Green', text: '"Witchety-witchety", "teacher-teacher", and "zee-zee-zee-zoo-zee". Learn these three by ear and you will find them without trying.', species: ['Common Yellowthroat', 'Ovenbird', 'Black-throated Green Warbler'] },
        { title: 'Where they are: edges in the first hour of sun', text: 'Warblers feed where the sun hits first. Stand on the west side of an edge at sunrise and watch the lit treetops.', species: ['Yellow Warbler', 'American Redstart', 'Magnolia Warbler'] },
        { title: 'The ground and trunk ones', text: 'Not every warbler is in the canopy. Ovenbird walks the forest floor, Black-and-white creeps on bark, Palm pumps its tail on the ground.', species: ['Ovenbird', 'Black-and-white Warbler', 'Palm Warbler', 'Northern Waterthrush'] },
        { title: 'Fall: wing bars and undertail', text: 'In September most warblers are dull. Go by wing bars, undertail color and tail pattern, and settle for "a warbler" when you have to.', species: ['Yellow-rumped Warbler', 'Palm Warbler', 'Magnolia Warbler', 'Pine Warbler'] },
        { title: 'One ten-warbler morning in May', text: 'A GO day in the middle of May, a sunlit edge, two hours. Ten kinds is a real morning.', species: ['Yellow-rumped Warbler', 'Yellow Warbler', 'Common Yellowthroat', 'Black-throated Green Warbler', 'Black-and-white Warbler', 'American Redstart', 'Ovenbird', 'Magnolia Warbler', 'Pine Warbler', 'Palm Warbler'] },
      ] },
    { id: 'raptors', title: 'Raptors', group: 'raptors',
      why: 'Hawks are big, slow and out in the open, which makes them a good group for the car and the commute. The trick is shape and flight style, not color, because you will almost always see them against the sky.',
      steps: [
        { title: 'Red-tailed Hawk vs. Turkey Vulture', text: 'The two big birds over every field. Red-tail soars flat with a pale chest and a belly band; the vulture wobbles in a shallow V with two-toned wings and a tiny head.', species: ['Red-tailed Hawk', 'Turkey Vulture'] },
        { title: 'Buteo, accipiter, falcon: three shapes', text: 'Broad wings and a short tail soar (buteo). Short wings and a long tail flap-flap-glide (accipiter). Pointed wings fly fast and direct (falcon).', species: ['Red-tailed Hawk', 'Cooper\'s Hawk', 'American Kestrel'] },
        { title: 'The feeder hawk: Cooper\'s vs. Sharp-shinned', text: 'The hawk that hits your feeder. Cooper\'s is crow-sized with a rounded tail tip; Sharpie is jay-sized with a square tail. Do not expect to be sure every time.', species: ['Cooper\'s Hawk', 'Sharp-shinned Hawk'] },
        { title: 'Kestrel on a wire, harrier over a marsh', text: 'Two field birds with signature moves: the kestrel hovers and bobs on wires; the harrier tilts low over grass with a white rump.', species: ['American Kestrel', 'Northern Harrier'] },
        { title: 'A fall hawk watch on a sunny ridge', text: 'Mid-September after a cold front, 10 AM to 2 PM, any ridge with a view north. Broad-wings pass in kettles; the Brief\'s soaring line tells you which day.', species: ['Broad-winged Hawk', 'Sharp-shinned Hawk', 'Bald Eagle', 'Osprey'] },
        { title: 'Bald Eagle and Osprey on the river', text: 'Both big and fish-eating, both back from the brink. Osprey has crooked wings and a white belly; the adult eagle is unmistakable, the young one is a big brown bird with a huge bill.', species: ['Bald Eagle', 'Osprey'] },
      ] },
    { id: 'sparrows', title: 'Sparrows', group: 'sparrows',
      why: 'Sparrows are the group that turns a beginner into a birder, because you have to actually look. The good news is that the head does most of the work, and the common ones come to the feeder and the weedy edge where you can study them.',
      steps: [
        { title: 'Song Sparrow: the one to compare everything to', text: 'Streaky brown with a dark spot in the middle of the chest, in every weedy edge all year. Learn its song too: three notes and a jumble.', species: ['Song Sparrow'] },
        { title: 'Junco and House Sparrow: the two that are not brown', text: 'Slate gray with a white belly and white outer tail is a Junco. A gray crown and black bib at the feeder is a House Sparrow. Both are easy; get them out of the way.', species: ['Dark-eyed Junco', 'House Sparrow'] },
        { title: 'Head stripes: White-throated vs. White-crowned', text: 'Both have bold head stripes. White-throated has a white throat and yellow in front of the eye; White-crowned has a clean gray breast and a pink bill. Listen for "Oh sweet Canada".', species: ['White-throated Sparrow', 'White-crowned Sparrow'] },
        { title: 'Rusty caps: Chipping vs. Field', text: 'Chipping has a rusty cap and a black line through the eye; Field has a pink bill and a plain face. Both in open edges in summer.', species: ['Chipping Sparrow', 'Field Sparrow'] },
        { title: 'The field and marsh ones', text: 'Savannah in short grass with yellow in front of the eye; Swamp in the cattails with rusty wings. Walk a field edge and a marsh edge on the same morning.', species: ['Savannah Sparrow', 'Swamp Sparrow'] },
        { title: 'October: a sparrow morning on a weedy edge', text: 'Mid-October is peak sparrow. Walk a weedy field edge at first light, stand still, and let them pop up. Six kinds in a morning is a good day.', species: ['Song Sparrow', 'White-throated Sparrow', 'White-crowned Sparrow', 'Savannah Sparrow', 'Swamp Sparrow', 'Dark-eyed Junco', 'Eastern Towhee'] },
      ] },
  ],
};
