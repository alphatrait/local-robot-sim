def init(sim):
    sim.log("diff-drive controller ready")
    sim.set_joint_velocity("left_wheel_joint", 0.0)
    sim.set_joint_velocity("right_wheel_joint", 0.0)

def step(sim, dt):
    t = sim.time()

    # Drive forward for 2 seconds, spin for 2 seconds, repeat.
    phase = int(t) % 4
    if phase < 2:
        sim.set_joint_velocity("left_wheel_joint", 4.0)
        sim.set_joint_velocity("right_wheel_joint", 4.0)
    else:
        sim.set_joint_velocity("left_wheel_joint", 2.0)
        sim.set_joint_velocity("right_wheel_joint", -2.0)

    if int(t * 10) % 20 == 0:
        pose = sim.get_body_pose("base_link")
        sim.log(f"base_link x={pose['x']:.2f} z={pose['z']:.2f}")
